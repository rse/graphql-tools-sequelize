/*
**  GraphQL-Tools-Sequelize -- Integration of GraphQL-Tools and Sequelize ORM
**  Copyright (c) 2016-2019 Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  the mixin class  */
export default class gtsEntityClone {
    /*  API: clone an entity (without relationships)  */
    entityCloneSchema (type) {
        return "" +
            `# Clone one [${type}]() entity by cloning its attributes (but not its relationships).\n` +
            `clone: ${type}!\n`
    }
    entityCloneResolver (type) {
        return async (entity, args, ctx, info) => {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error("method \"clone\" only allowed under \"mutation\" operation")
            if (typeof entity === "object" && entity instanceof this._anonCtx && entity.isType(type))
                throw new Error(`method "clone" only allowed in non-anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this._fieldsOfGraphQLType(info, type)

            /*  check access to parent entity  */
            if (!(await this._authorized("after", "read", type, entity, ctx)))
                throw new Error(`not allowed to read entity of type "${type}"`)

            /*  build a new entity  */
            let data = {}
            data[this._idname] = this._idmake()
            Object.keys(defined.attribute).forEach((attr) => {
                if (attr !== this._idname)
                    data[attr] = entity[attr]
            })
            let obj = this._models[type].build(data)

            /*  check access to entity before action  */
            if (!(await this._authorized("before", "create", type, obj, ctx)))
                throw new Error(`will not be allowed to clone entity of type "${type}"`)

            /*  save new entity  */
            let opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            let err = await obj.save(opts).catch((err) => err)
            if (typeof err === "object" && err instanceof Error)
                throw new Error("Sequelize: save: " + err.message + ":" +
                    err.errors.map((e) => e.message).join("; "))

            /*  check access to entity after action  */
            if (!(await this._authorized("after", "create", type, obj, ctx)))
                throw new Error(`was not allowed to clone entity of type "${type}"`)

            /*  check access to entity again  */
            if (!(await this._authorized("after", "read", type, obj, ctx)))
                throw new Error(`was not allowed to read (cloned) entity of type "${type}"`)

            /*  map field values  */
            this._mapFieldValues(type, obj, ctx, info)

            /*  update FTS index  */
            this._ftsUpdate(type, obj[this._idname], obj, "create")

            /*  trace access  */
            await this._trace({
                op:       "create",
                arity:    "one",
                dstType:  type,
                dstIds:   [ obj[this._idname] ],
                dstAttrs: Object.keys(data)
            }, ctx)

            /*  return new entity  */
            return obj
        }
    }
}

