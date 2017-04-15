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
import Bluebird   from "bluebird"
import capitalize from "capitalize"

/*  the mixin class  */
export default class gtsEntityQuery {
    /*  initialize the mixin  */
    initializer () {
        /*  NO-OP  */
    }

    /*  API: query/read one or many entities (directly or via relation)  */
    entityQuerySchema (source, relation, target) {
        let m
        if ((m = target.match(/^(.+)\*$/)) !== null) {
            target = m[1]
            /*  MANY  */
            if (relation === "")
                /*  directly  */
                return "" +
                    `# Query one or many [${target}]() entities,\n` +
                    "# by either an (optionally available) full-text-search (`query`)\n" +
                    "# or an (always available) attribute-based condition (`where`),\n" +
                    "# optionally sort them (`order`),\n" +
                    "# optionally start the result set at the n-th entity (zero-based `offset`), and\n" +
                    "# optionally reduce the result set to a maximum number of entities (`limit`).\n" +
                    `${target}s(fts: String, where: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
            else
                /*  via relation  */
                return "" +
                    `# Query one or many [${target}]() entities\n` +
                    `# by following the **${relation}** relation of [${source}]() entity,\n` +
                    "# optionally filter them by a condition (`where`),\n" +
                    "# optionally sort them (`order`),\n" +
                    "# optionally start the result set at the n-th entity (zero-based `offset`), and\n" +
                    "# optionally reduce the result set to a maximum number of entities (`limit`).\n" +
                    `${relation}(where: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
        }
        else {
            /*  ONE  */
            if (relation === "")
                /*  directly  */
                return "" +
                    `# Query one [${target}]() entity by its unique id or open an anonymous context for [${target}].\n` +
                    `${target}(id: ${this._idtype}): ${target}\n`
            else
                /*  via relation  */
                return "" +
                    `# Query one [${target}]() entity by following the **${relation}** relation of [${source}]() entity.\n` +
                    `# The [${target}]() entity can be optionally filtered by a condition (\`where\`).\n` +
                    `${relation}(where: JSON): ${target}\n`
        }
    }
    entityQueryResolver (source, relation, target) {
        let isMany = false
        let m
        if ((m = target.match(/^(.+)\*$/)) !== null) {
            target = m[1]
            isMany = true
        }
        return async (parent, args, ctx, info) => {
            if (isMany) {
                /*  MANY  */

                /*  determine filter options  */
                let opts = this._findManyOptions(target, args, info)
                if (ctx.tx !== undefined)
                    opts.transaction = ctx.tx

                /*  find entities  */
                let objs
                if (relation === "") {
                    /*  directly  */
                    if (args.fts !== undefined)
                        /*  directly, via FTS index  */
                        objs = await this._ftsSearch(target, args.fts, args.order, args.offset, args.limit, ctx)
                    else
                        /*  directly, via database  */
                        objs = await this._models[target].findAll(opts)
                }
                else {
                    /*  via relation  */
                    let getter = `get${capitalize(relation)}`
                    objs = await parent[getter](opts)
                }

                /*  check authorization  */
                objs = await Bluebird.filter(objs, (obj) => {
                    return this._authorized("read", target, obj, ctx)
                })

                /*  map field values  */
                await Bluebird.each(objs, (obj) => {
                    this._mapFieldValues(target, obj, ctx, info)
                })

                /*  trace access  */
                await Bluebird.each(objs, (obj) => {
                    return this._trace(target, obj.id, obj, "read", relation === "" ? "direct" : "relation", "many", ctx)
                })

                return objs
            }
            else {
                /*  ONE  */

                /*  determine filter options  */
                let opts = this._findOneOptions(target, args, info)
                if (ctx.tx !== undefined)
                    opts.transaction = ctx.tx

                /*  find entity  */
                let obj
                if (relation === "") {
                    /*  directly  */
                    if (args.id === undefined)
                        /*  special case: anonymous context  */
                        return new this._anonCtx(target)
                    else
                        /*  regular case: non-anonymous context  */
                        obj = await this._models[target].findById(args.id, opts)
                }
                else {
                    /*  via relation  */
                    let getter = `get${capitalize(relation)}`
                    obj = await parent[getter](opts)
                }
                if (obj === null)
                    return null

                /*  check authorization  */
                if (!(await this._authorized("read", target, obj, ctx)))
                    return null

                /*  map field values  */
                this._mapFieldValues(target, obj, ctx, info)

                /*  trace access  */
                await this._trace(target, obj.id, obj, "read", relation === "" ? "direct" : "relation", "one", ctx)

                return obj
            }
        }
    }
}

