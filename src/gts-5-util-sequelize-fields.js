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
import capitalize from "capitalize"

/*  the mixin class  */
export default class gtsUtilSequelizeFields {
    /*  update all relation fields of an entity  */
    async _entityUpdateFields (type, obj, def, upd, ctx, info) {
        /*  determine common Sequelize options  */
        let opts = {}
        if (ctx.tx !== undefined)
            opts.transaction = ctx.tx

        /*  iterate over all relationships...  */
        let rels = Object.keys(upd)
        for (let i = 0; i < rels.length; i++) {
            let name  = rels[i]

            /*  determine target type and relationship cardinality  */
            let t = info.schema._typeMap[type]._fields[name].type
            let many = false
            while (typeof t.ofType === "object") {
                if (t.constructor.name === "GraphQLList")
                    many = true
                t = t.ofType
            }
            let target = t.name

            /*  helper method for changing a single relationship  */
            const changeRelation = async (prefix, ids) => {
                /*  map all ids onto real ORM objects  */
                let opts2 = Object.assign({}, opts, { where: { id: ids } })
                let objs = await this._models[target].findAll(opts2)

                /*  sanity check requested ids  */
                if (objs.length < ids.length) {
                    let found = {}
                    objs.forEach((obj) => { found[obj.id] = true })
                    for (let j = 0; j < ids.length; j++)
                        if (!found[ids[j]])
                            throw new Error(`no such entity ${target}#${ids[j]} found`)
                }

                /*  sanity check usage  */
                if (!many && ids.length > 1)
                    throw new Error(`relationship ${name} on type ${type} has cardinality 0..1 ` +
                        "and cannot receive more than one foreign entity")

                /*  change relationship  */
                if (many) {
                    /*  change relationship of cardinality 0..N  */
                    let method = `${prefix}${capitalize(name)}`
                    if (typeof obj[method] !== "function")
                        throw new Error("relationship mutation method not found " +
                            `to ${prefix} relation ${name} on type ${type}`)
                    await obj[method](objs, opts)
                }
                else {
                    /*  change relationship of cardinality 0..1  */
                    if (prefix === "add")
                        prefix = "set"
                    let method = `${prefix}${capitalize(name)}`
                    if (typeof obj[method] !== "function")
                        throw new Error("relationship mutation method not found " +
                            `to ${prefix} relation ${name} on type ${type}`)
                    let relObj = prefix !== "remove" ? (objs.length ? objs[0] : null) : null
                    await obj[method](relObj, opts)
                }
            }

            /*  determine relationship value and dispatch according to operation  */
            let value = upd[name]
            if (value.set) await changeRelation("set",    value.set)
            if (value.del) await changeRelation("remove", value.del)
            if (value.add) await changeRelation("add",    value.add)
        }
    }

    /*  map Sequelize "undefined" values to GraphQL "null" values to
        ensure that the GraphQL engine does not complain about resolvers
        which return "undefined" for "null" values.  */
    _mapFieldValues (type, obj, ctx, info) {
        /*  determine allowed fields  */
        let allowed = this._fieldsOfGraphQLType(info, type)

        /*  iterate over all GraphQL attributes  */
        Object.keys(allowed.attribute).forEach((attribute) => {
            /*  map Sequelize "undefined" to GraphQL "null"  */
            if (obj[attribute] === undefined)
                obj[attribute] = null
        })
    }
}

