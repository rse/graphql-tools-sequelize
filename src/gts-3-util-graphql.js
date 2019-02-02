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

/*  external dependencies  */
import Ducky from "ducky"

/*  the mixin class  */
export default class gtsUtilGraphQL {
    /*  return requested fields of GraphQL query  */
    _graphqlRequestedFields (info, obj) {
        const flattenAST = (ast, obj) => {
            let selections = []
            if (   ast
                && ast.selectionSet
                && ast.selectionSet.selections
                && ast.selectionSet.selections.length > 0)
                selections = ast.selectionSet.selections
            return selections.reduce((flattened, ast) => {
                if (ast.kind === "InlineFragment")
                    flattened = flattenAST(ast, flattened)
                else if (ast.kind === "FragmentSpread")
                    flattened = flattenAST(info.fragments[ast.name.value], flattened)
                else {
                    const name = ast.name.value
                    if (flattened[name])
                        Object.assign(flattened[name], flattenAST(ast, flattened[name]))
                    else
                        flattened[name] = flattenAST(ast, {})
                }
                return flattened
            }, obj)
        }
        return info.fieldNodes.reduce((obj, ast) => flattenAST(ast, obj), obj || {})
    }

    /*  determine fields (and their type) of a GraphQL object type  */
    _fieldsOfGraphQLType (info, entity) {
        let fields = { attribute: {}, relation: {}, method: {} }
        let fieldsAll = info.schema._typeMap[entity]._fields
        Object.keys(fieldsAll).forEach((field) => {
            let type = fieldsAll[field].type
            while (typeof type.ofType === "object")
                type = type.ofType
            if (field.match(/^(?:clone|create|update|delete)$/))
                fields.method[field] = type.name
            else if (   type.constructor.name === "GraphQLScalarType"
                     || type.constructor.name === "GraphQLEnumType"  )
                fields.attribute[field] = type.name
            else if (   type.constructor.name === "GraphQLObjectType"
                     && typeof fieldsAll[field].resolve === "function")
                fields.relation[field] = type.name
            else
                throw new Error(`unknown type "${type.constructor.name}" for field "${field}"`)
        })
        return fields
    }

    /*  determine fields (and their type) of a GraphQL request  */
    _fieldsOfGraphQLRequest (args, info, entity) {
        let defined = this._fieldsOfGraphQLType(info, entity)
        let fields = { attribute: {}, relation: {} }
        if (typeof args.with === "object") {
            Object.keys(args.with).forEach((name) => {
                if (defined.relation[name]) {
                    let value = args.with[name]
                    if (typeof value === "string")
                        value = { set: value }
                    if (typeof value !== "object")
                        throw new Error(`invalid value for relation "${name}" on type "${entity}"`)
                    if (value === null)
                        value = { set: [] }
                    else {
                        if (value.set === null) value.set = []
                        if (value.add === null) value.add = []
                        if (value.del === null) value.del = []
                        if (typeof value.set === "string") value.set = [ value.set ]
                        if (typeof value.add === "string") value.add = [ value.add ]
                        if (typeof value.del === "string") value.del = [ value.del ]
                        if (!Ducky.validate(value, "{ set?: [ string* ], add?: [ string+ ], del?: [ string+ ] }"))
                            throw new Error(`invalid value for relation "${name}" on type "${entity}"`)
                    }
                    fields.relation[name] = value
                }
                else if (defined.attribute[name]) {
                    let value = args.with[name]
                    let type = info.schema._typeMap[entity]._fields[name].type
                    while (typeof type.ofType === "object")
                        type = type.ofType
                    if (   type.constructor.name === "GraphQLScalarType"
                        && typeof type.parseValue === "function"
                        && value !== null)
                        value = type.parseValue(value)
                    else if (   type.constructor.name === "GraphQLEnumType"
                             && value !== null) {
                        if (typeof value !== "string")
                            throw new Error("invalid value type (expected string) for " +
                                `enumeration "${type.name}" on field "${name}" on type "${entity}"`)
                        if (type._enumConfig.values[value] === undefined)
                            throw new Error("invalid value for " +
                                `enumeration "${type.name}" on field "${name}" on type "${entity}"`)
                    }
                    fields.attribute[name] = value
                }
                else
                    throw new Error(`field "${name}" not known on type "${entity}"`)
            })
        }
        return fields
    }
}

