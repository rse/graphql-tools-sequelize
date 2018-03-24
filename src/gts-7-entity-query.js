/*
**  GraphQL-Tools-Sequelize -- Integration of GraphQL-Tools and Sequelize ORM
**  Copyright (c) 2016-2018 Ralf S. Engelschall <rse@engelschall.com>
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
    /*  calculate hash code of entity  */
    _hashCodeForEntity (info, type, obj) {
        let fields = this._fieldsOfGraphQLType(info, type)
        let data = Object.keys(fields.attribute)
            .sort()
            .filter((name) => name !== this._hcname)
            .map((attribute) => JSON.stringify(obj[attribute]))
            .join(",")
        return this._hcmake(data)
    }

    /*  API: query/read identifier and hash-code attributes  */
    attrIdSchema (source) {
        return "" +
            `# the unique identifier of the [${source}]() entity.\n` +
            `${this._idname}: ${this._idtype}!\n`
    }
    attrIdResolver (source) {
        return (parent, args, ctx, info) => {
            return parent[this._idname]
        }
    }
    attrHcSchema (source) {
        return "" +
            `# the hash-code of the [${source}]() entity.\n` +
            `${this._hcname}: ${this._hctype}!\n`
    }
    attrHcResolver (source) {
        return (parent, args, ctx, info) => {
            return this._hashCodeForEntity(info, source, parent)
        }
    }

    /*  API: query/read one or many entities (directly or via relation)  */
    entityQuerySchema (source, relation, target) {
        let isMany = false
        let m
        if ((m = target.match(/^(.+)\*$/)) !== null) {
            target = m[1]
            isMany = true
        }
        if (isMany) {
            /*  MANY  */
            if (relation === "")
                /*  directly  */
                return "" +
                    `# Query one or many [${target}]() entities,\n` +
                    "# by either an (optionally available) full-text-search (`query`)\n" +
                    "# or an (always available) attribute-based condition (`where`),\n" +
                    "# optionally filter them by a condition on some relationships (`include`),\n" +
                    "# optionally sort them (`order`),\n" +
                    "# optionally start the result set at the n-th entity (zero-based `offset`), and\n" +
                    "# optionally reduce the result set to a maximum number of entities (`limit`).\n" +
                    `${target}s(fts: String, where: JSON, include: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
            else
                /*  via relation  */
                return "" +
                    `# Query one or many [${target}]() entities\n` +
                    `# by following the **${relation}** relation of [${source}]() entity,\n` +
                    "# optionally filter them by a condition (`where`),\n" +
                    "# optionally filter them by a condition on some relationships (`include`),\n" +
                    "# optionally sort them (`order`),\n" +
                    "# optionally start the result set at the n-th entity (zero-based `offset`), and\n" +
                    "# optionally reduce the result set to a maximum number of entities (`limit`).\n" +
                    `${relation}(where: JSON, include: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
        }
        else {
            /*  ONE  */
            if (relation === "")
                /*  directly  */
                return "" +
                    `# Query one [${target}]() entity by its unique identifier (\`id\`) or condition (\`where\`) or` +
                    `# open an anonymous context for the [${target}]() entity.\n` +
                    `# The [${target}]() entity can be optionally required to have a particular hash-code (\`${this._hcname}\`) for optimistic locking purposes.\n` +
                    `# The [${target}]() entity can be optionally filtered by a condition on some relationships (\`include\`).\n` +
                    `${target}(id: ${this._idtype}, ${this._hcname}: ${this._hctype}, where: JSON, include: JSON): ${target}\n`
            else
                /*  via relation  */
                return "" +
                    `# Query one [${target}]() entity by following the **${relation}** relation of [${source}]() entity.\n` +
                    `# The [${target}]() entity can be optionally required to have a particular hash-code (\`${this._hcname}\`) for optimistic locking purposes.\n` +
                    `# The [${target}]() entity can be optionally filtered by a condition (\`where\`).\n` +
                    `# The [${target}]() entity can be optionally filtered by a condition on some relationships (\`include\`).\n` +
                    `${relation}(${this._hcname}: ${this._hctype}, where: JSON, include: JSON): ${target}\n`
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
                    return this._authorized("after", "read", target, obj, ctx)
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
                    if (args.id !== undefined)
                        /*  regular case: non-anonymous context, find by identifier  */
                        obj = await this._models[target].findById(args.id, opts)
                    else if (args.where !== undefined)
                        /*  regular case: non-anonymous context, find by condition  */
                        obj = await this._models[target].findOne(opts)
                    else
                        /*  special case: anonymous context  */
                        return new this._anonCtx(target)
                }
                else {
                    /*  via relation  */
                    let getter = `get${capitalize(relation)}`
                    obj = await parent[getter](opts)
                }
                if (obj === null)
                    return null

                /*  check optional hash-code  */
                if (args[this._hcname] !== undefined) {
                    let hc = this._hashCodeForEntity(info, target, obj)
                    if (hc !== args[this._hcname])
                        throw new Error(`entity ${target}#${obj.id} has hash-code ${hc} ` +
                            `(expected hash-code ${args[this._hcname]})`)
                }

                /*  check authorization  */
                if (!(await this._authorized("after", "read", target, obj, ctx)))
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

