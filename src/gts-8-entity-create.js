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

/*  external dependencies  */
import co from "co"

/*  the API class  */
export default class gtsEntityCreate {
    /*  initialize the mixin  */
    initializer () {
        /*  NO-OP  */
    }

    /*  API: create a new entity  */
    entityCreateSchema (type) {
        return `` +
            `# Create new [${type}]() entity, optionally with specified attributes (\`with\`)\n` +
            `create(id: ${this._idtype}, with: JSON): ${type}!\n`
    }
    entityCreateResolver (type) {
        return co.wrap(function * (entity, args, ctx, info) {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error(`method "create" only allowed under "mutation" operation`)
            if (!(typeof entity === "object" && entity instanceof this._anonCtx && entity.isType(type)))
                throw new Error(`method "create" only allowed in anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this._fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this._fieldsOfGraphQLRequest(args, info, type)

            /*  handle unique id  */
            if (args.id === undefined)
                /*  auto-generate the id  */
                build.attribute.id = this._idmake()
            else {
                /*  take over id, but ensure it is unique  */
                build.attribute.id = args.id
                let opts = {}
                if (ctx.tx !== undefined)
                    opts.transaction = ctx.tx
                let existing = yield (this._models[type].findById(build.attribute.id, opts))
                if (existing !== null)
                    throw new Error(`entity ${type}#${build.attribute.id} already exists`)
            }

            /*  validate attributes  */
            yield (this._validate(type, build.attribute, ctx))

            /*  build a new entity  */
            let obj = this._models[type].build(build.attribute)

            /*  check access to entity  */
            if (!(yield (this._authorized("create", type, obj, ctx))))
                throw new Error(`not allowed to create entity of type "${type}"`)

            /*  save new entity  */
            let opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            let err = yield (obj.save(opts).catch((err) => err))
            if (typeof err === "object" && err instanceof Error)
                throw new Error("Sequelize: save: " + err.message + ":" +
                    err.errors.map((e) => e.message).join("; "))

            /*  post-adjust the relationships according to the request  */
            yield (this._entityUpdateFields(type, obj,
                defined.relation, build.relation, ctx, info))

            /*  check access to entity again  */
            if (!(yield (this._authorized("read", type, obj, ctx))))
                return null

            /*  map field values  */
            this._mapFieldValues(type, obj, ctx, info)

            /*  update FTS index  */
            this._ftsUpdate(type, obj.id, obj, "create")

            /*  trace access  */
            yield (this._trace(type, obj.id, obj, "create", "direct", "one", ctx))

            /*  return new entity  */
            return obj
        }.bind(this))
    }
}

