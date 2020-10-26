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
export default class gtsEntityDelete {
    /*  API: delete an entity  */
    entityDeleteSchema (type) {
        return "" +
            `# Delete one [${type}]() entity.\n` +
            `delete: ${this._idtype}!\n`
    }
    entityDeleteResolver (type) {
        return async (entity, args, ctx, info) => {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error("method \"delete\" only allowed under \"mutation\" operation")
            if (typeof entity === "object" && entity instanceof this._anonCtx && entity.isType(type))
                throw new Error(`method "delete" only allowed in non-anonymous ${type} context`)

            const result = await this._entityDelete(type, entity, args, ctx, info)

            /*  return id of deleted entity  */
            return result
        }
    }
    async _entityDelete (type, entity, args, ctx) {
        /*  check access to target before action  */
        if (!(await this._authorized("before", "delete", type, entity, ctx)))
            return new Error(`will not be allowed to delete entity of type "${type}"`)

        /*  delete the instance  */
        const opts = {}
        if (ctx.tx !== undefined)
            opts.transaction = ctx.tx
        const result = entity[this._idname]
        await entity.destroy(opts)

        /*  update FTS index  */
        this._ftsUpdate(type, result, null, "delete")

        /*  trace access  */
        await this._trace({
            op:       "delete",
            arity:    "one",
            dstType:  type,
            dstIds:   [ result ],
            dstAttrs: [ "*" ]
        }, ctx)

        /*  return id of deleted entity  */
        return result
    }
}

