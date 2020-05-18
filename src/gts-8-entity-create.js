/*
**  GraphQL-Tools-Sequelize -- Integration of GraphQL-Tools and Sequelize ORM
**  Copyright (c) 2016-2020 Dr. Ralf S. Engelschall <rse@engelschall.com>
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
export default class gtsEntityCreate {
    /*  API: create a new entity  */
    entityCreateSchema (type) {
        return "" +
            `# Create new [${type}]() entity, optionally with specified unique identifier (\`${this._idname}\`) and attributes (\`with\`).\n` +
            `create(${this._idname}: ${this._idtype}, with: JSON): ${type}!\n`
    }
    entityCreateResolver (type) {
        return async (entity, args, ctx, info) => {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error("method \"create\" only allowed under \"mutation\" operation")
            if (!(typeof entity === "object" && entity instanceof this._anonCtx && entity.isType(type)))
                throw new Error(`method "create" only allowed in anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            const defined = this._fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            const build = this._fieldsOfGraphQLRequest(args, info, type)

            /*  handle unique id  */
            if (args[this._idname] === undefined)
                /*  auto-generate the id  */
                build.attribute[this._idname] = this._idmake()
            else {
                /*  take over id, but ensure it is unique  */
                build.attribute[this._idname] = args[this._idname]
                const opts = {}
                if (ctx.tx !== undefined)
                    opts.transaction = ctx.tx
                opts.attributes = [ this._idname ]
                const existing = await this._models[type].findByPk(build.attribute[this._idname], opts)
                if (existing !== null)
                    throw new Error(`entity ${type}#${build.attribute[this._idname]} already exists`)
            }

            /*  validate attributes  */
            await this._validate(type, build, ctx)

            /*  build a new entity  */
            const obj = this._models[type].build(build.attribute)

            /*  check access to entity before action  */
            if (!(await this._authorized("before", "create", type, obj, ctx)))
                throw new Error(`will not be allowed to create entity of type "${type}"`)

            /*  save new entity  */
            const opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            const err = await obj.save(opts).catch((err) => err)
            if (typeof err === "object" && err instanceof Error)
                throw new Error("Sequelize: save: " + err.message + ":" +
                    err.errors.map((e) => e.message).join("; "))

            /*  post-adjust the relationships according to the request  */
            await this._entityUpdateFields(type, obj,
                defined.relation, build.relation, ctx, info)

            /*  check access to entity after action  */
            if (!(await this._authorized("after", "create", type, obj, ctx)))
                throw new Error(`was not allowed to create entity of type "${type}"`)

            /*  check access to entity again  */
            if (!(await this._authorized("after", "read", type, obj, ctx)))
                throw new Error(`was not allowed to read (created) entity of type "${type}"`)

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
                dstAttrs: Object.keys(build.attribute).concat(Object.keys(build.relation))
            }, ctx)

            /*  return new entity  */
            return obj
        }
    }
}

