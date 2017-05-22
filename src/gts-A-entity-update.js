/*
**  GraphQL-Tools-Sequelize -- Integration of GraphQL-Tools and Sequelize ORM
**  Copyright (c) 2016-2017 Ralf S. Engelschall <rse@engelschall.com>
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
export default class gtsEntityUpdate {
    /*  API: update an entity  */
    entityUpdateSchema (type) {
        return "" +
            `# Update one [${type}]() entity with specified attributes (\`with\`).\n` +
            `update(with: JSON!): ${type}!\n`
    }
    entityUpdateResolver (type) {
        return async (entity, args, ctx, info) => {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error("method \"update\" only allowed under \"mutation\" operation")
            if (typeof entity === "object" && entity instanceof this._anonCtx && entity.isType(type))
                throw new Error(`method "update" only allowed in non-anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this._fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this._fieldsOfGraphQLRequest(args, info, type)

            /*  check access to entity before action  */
            if (!(await this._authorized("before", "update", type, entity, ctx)))
                throw new Error(`will not be allowed to update entity of type "${type}"`)

            /*  validate attributes  */
            await this._validate(type, build.attribute, ctx)

            /*  adjust the attributes according to the request  */
            let opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            await entity.update(build.attribute, opts)

            /*  adjust the relationships according to the request  */
            await this._entityUpdateFields(type, entity,
                defined.relation, build.relation, ctx, info)

            /*  check access to entity after action  */
            if (!(await this._authorized("after", "update", type, entity, ctx)))
                throw new Error(`was not allowed to update entity of type "${type}"`)

            /*  check access to entity again  */
            if (!(await this._authorized("after", "read", type, entity, ctx)))
                return null

            /*  map field values  */
            this._mapFieldValues(type, entity, ctx, info)

            /*  update FTS index  */
            this._ftsUpdate(type, entity.id, entity, "update")

            /*  trace access  */
            await this._trace(type, entity.id, entity, "update", "direct", "one", ctx)

            /*  return updated entity  */
            return entity
        }
    }
}

