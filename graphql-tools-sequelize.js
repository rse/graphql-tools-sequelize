/*
**  GraphQL-Tools-Sequelize -- Resolver Functions for GraphQL-Tools using Sequelize ORM
**  Copyright (c) 2016 Ralf S. Engelschall <rse@engelschall.com>
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

import UUID              from "pure-uuid"
import capitalize        from "capitalize"
import co                from "co"
import Ducky             from "ducky"
import Promise           from "bluebird"
import * as GraphQL      from "graphql"
import GraphQLFields     from "graphql-fields"

export default class GraphQLToolsSequelize {
    constructor (sequelize, authorizers) {
        this.db          = sequelize
        this.dm          = sequelize.models
        this.authorizers = authorizers
    }

    /*   check authorization  */
    authorized (op, type, instance, ctx) {
        if (this.authorizers[type] === undefined)
            return Promise.resolve(true)
        let result = this.authorizers[type](op, instance, ctx)
        if (typeof result === "boolean")
            result = Promise.resolve(result)
        return result
    }

    /*  map scalar types between GraphQL, JavaScript and Sequelize  */
    mapScalarType (type, from, to) {
        const scalarTypeMap = [
            { graphql: "Boolean", javascript: "boolean", sequelize: "BOOLEAN" },
            { graphql: "Int",     javascript: "number",  sequelize: "INTEGER" },
            { graphql: "Float",   javascript: "number",  sequelize: "FLOAT" },
            { graphql: "String",  javascript: "string",  sequelize: "STRING" },
            { graphql: "ID",      javascript: "string",  sequelize: "STRING" }
        ]
        return scalarTypeMap.find((item) => item[from] === type)[to]
    }

    /*  determine fields (and their type) of a GraphQL object type  */
    fieldsOfGraphQLType (info, entity) {
        let fields = { attribute: {}, relation: {} }
        let fieldsAll = info.schema._typeMap[entity]._fields
        Object.keys(fieldsAll).forEach((field) => {
            let type = fieldsAll[field].type
            while (typeof type.ofType === "object")
                type = type.ofType
            if (type instanceof GraphQL.GraphQLScalarType)
                fields.attribute[field] = type.name
            else if (type instanceof GraphQL.GraphQLObjectType)
                fields.relation[field] = type.name
            else
                throw new Error("unknown type for field: " + field)
        })
        return fields
    }

    /*  determine fields (and their type) of a GraphQL request  */
    fieldsOfGraphQLRequest (args, info, entity) {
        let defined = this.fieldsOfGraphQLType(info, entity)
        let fields = { attribute: {}, relation: {} }
        Object.keys(args.with).forEach((name) => {
            if (defined.relation[name]) {
                let value = args.with[name]
                if (typeof value === "string")
                    value = { $set: value }
                if (typeof value !== "object")
                    throw new Error(`invalid value for relation "${name}" on type "${entity}"`)
                if (typeof value.$set === "string")
                    value.$set = [ value.$set ]
                if (typeof value.$add === "string")
                    value.$add = [ value.$add ]
                if (typeof value.$del === "string")
                    value.$del = [ value.$del ]
                if (!Ducky.validate(value, `{
                    $set?: [ string* ], $add?: [ string+ ], $del?: [ string+ ] }`))
                    throw new Error(`invalid value for relation "${name}" on type "${entity}"`)
                fields.relation[name] = value
            }
            else if (defined.attribute[name]) {
                let type = this.mapScalarType(defined.attribute[name], "graphql", "javascript")
                if (typeof args.with[name] !== type)
                    throw new Error(`value for attribute "${name}" on type "${entity}" ` +
                        `has to be compatible with GrapQL type "${defined.attribute[name]}"`)
                fields.attribute[name] = args.with[name]
            }
            else
                throw new Error(`field "${name}" not known on type "${entity}"`)
        })
        return fields
    }

    /*  GraphQL standard options to Sequelize findAll() options conversion  */
    findAllOptions (entity, args, info) {
        let opts = {}

        /*  determine allowed fields  */
        let allowed = this.fieldsOfGraphQLType(info, entity)

        /*  determine Sequelize "where" parameter  */
        if (args.where !== undefined) {
            if (typeof args.where !== "object")
                throw new Error(`invalid "where" argument`)
            opts.where = args.where
            opts.where = {}
            Object.keys(args.where).forEach((field) => {
                if (!allowed.attribute[field])
                    throw new Error(`invalid "where" argument: ` +
                        `no such field "${field}" on type "${entity}"`)
                opts.where[field] = args.where[field]
            })
        }

        /*  determine Sequelize "offset" parameter  */
        if (args.offset !== undefined)
            opts.offset = args.offset

        /*  determine Sequelize "limit" parameter  */
        if (args.limit !== undefined)
            opts.limit = args.limit

        /*  determine Sequelize "order" parameter  */
        if (args.order  !== undefined) {
            if (!Ducky.validate(args.order, `( string | [ (string | [ string, string ])+ ])`))
                throw new Error(`invalid "order" argument: wrong structure`)
            opts.order = args.order
        }

        /*  determine Sequelize "attributes" parameter  */
        let attributes = Object.keys(GraphQLFields(info))
        if (attributes.length > 0)
            opts.attributes = attributes.filter((field) => allowed.attribute[field])

        return opts
    }

    queryEntityOne (entity) {
        return (parent, args, ctx) => {
            return this.dm[entity].findById(args.id).then((instance) =>
                instance !== null ? this.authorized("read", entity, instance, ctx).then((allowed) =>
                    allowed ? instance : null) : null)
        }
    }

    queryEntityAll (entity) {
        return (parent, args, ctx, info) => {
            let opts = this.findAllOptions(entity, args, info)
            return Promise.filter(this.dm[entity].findAll(opts), (instance) =>
                this.authorized("read", entity, instance, ctx))
        }
    }

    queryRelationOne (entity, getter) {
        return (instance, args, ctx) => {
            return instance[getter]().then((other) =>
                this.authorized("read", entity, other, ctx).then((allowed) =>
                    allowed ? other : null))
        }
    }

    queryRelationMany (entity, getter) {
        return (instance, args, ctx) => {
            return Promise.filter(instance[getter](), (other) =>
                this.authorized("read", entity, other, ctx))
        }
    }

    mutationEntityUpdateFields (entity, instance, def, upd) {
        return co(function * () {
            for (let i = 0; i < upd.length; i++) {
                let name = upd[i]
                const changeRelation = co.wrap(function * (prefix, ids) {
                    for (let j = 0; j < ids.length; j++) {
                        let type = def[name]
                        let foreign = yield (this.dm[type].findById(ids[j]))
                        yield (instance[`${prefix}${capitalize(name)}`](foreign))
                    }
                })
                if (upd[name].$set) yield (changeRelation("set",    upd[name].$set))
                if (upd[name].$del) yield (changeRelation("remove", upd[name].$del))
                if (upd[name].$add) yield (changeRelation("add",    upd[name].$add))
            }
        })
    }

    mutationEntityCreate (entity) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this.fieldsOfGraphQLType(info, entity)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this.fieldsOfGraphQLRequest(args, info, entity)

            /*  auto-generate the id  */
            if (build.attribute.id === undefined)
                build.attribute.id = (new UUID(1)).format()
            else {
                let existing = yield (this.dm[entity].findById(build.attribute.id))
                if (existing !== null)
                    throw new Error(`entity ${entity}#${build.attribute.id} already exists`)
            }

            /*  check access to target  */
            let allowed = yield (this.authorized("create", entity, null, ctx))
            if (!allowed)
                return new Error(`you are not allowed to create entity of type "${entity}"`)

            /*  build and save as a new entity  */
            let instance = this.dm.Account.build(build.attribute)
            let err = yield (instance.save().catch((err) => err))
            if (typeof err === "object" && err instanceof Error)
                throw new Error("Sequelize: save: " + err.message + ":" +
                    err.errors.map((e) => e.message).join("; "))

            /*  post-adjust the relationships according to the request  */
            yield (this.mutationEntityUpdateFields(entity, instance,
                defined.relation, build.relation))

            /*  check access to target again  */
            allowed = yield (this.authorized("read", entity, instance, ctx))
            if (!allowed)
                return null

            /*  return new entity  */
            return instance
        }.bind(this))
    }

    mutationEntityUpdateOne (entity) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this.fieldsOfGraphQLType(info, entity)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this.fieldsOfGraphQLRequest(args, info, entity)

            /*  load entity instance  */
            let instance = yield (this.dm[entity].findById(args.id))
            if (instance === null)
                throw new Error(`entity ${entity}#${args.id} not found`)

            /*  check access to target  */
            let allowed = yield (this.authorized("update", entity, instance, ctx))
            if (!allowed)
                return new Error(`you are not allowed to update entity of type "${entity}"`)

            /*  adjust the attributes according to the request  */
            instance.update(build.attribute)

            /*  adjust the relationships according to the request  */
            yield (this.mutationEntityUpdateFields(entity, instance,
                defined.relation, build.relation))

            /*  check access to target again  */
            allowed = yield (this.authorized("read", entity, instance, ctx))
            if (!allowed)
                return null
            return instance
        }.bind(this))
    }

    mutationEntityUpdateMany (entity) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this.fieldsOfGraphQLType(info, entity)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this.fieldsOfGraphQLRequest(args, info, entity)

            /*  load entity instances  */
            let opts = this.findAllOptions(entity, args, info)
            let instances = yield (this.dm[entity].findAll(opts))
            if (instances.length === 0)
                throw new Error(`no such entities found`)

            /*  iterate over all entities  */
            for (let i = 0; i < instances.length; i++) {
                let instance = instances[i]

                /*  check access to target  */
                let allowed = yield (this.authorized("update", entity, instance, ctx))
                if (!allowed)
                    return new Error(`you are not allowed to update entity of type "${entity}"`)

                /*  adjust the attributes according to the request  */
                instance.update(build.attribute)

                /*  adjust the relationships according to the request  */
                yield (this.mutationEntityUpdateFields(entity, instance,
                    defined.relation, build.relation))
            }

            /*  return check access to targets again  */
            return Promise.filter(instances, (instance) =>
                this.authorized("read", entity, instance, ctx))
        }.bind(this))
    }

    mutationEntityDeleteOne (entity) {
        return co.wrap(function * (parent, args, ctx /*, info */) {
            /*  load entity instance  */
            let instance = yield (this.dm[entity].findById(args.id))
            if (instance === null)
                throw new Error(`entity ${entity}#${args.id} not found`)

            /*  check access to target  */
            let allowed = yield (this.authorized("delete", entity, instance, ctx))
            if (!allowed)
                return new Error(`you are not allowed to delete entity of type "${entity}"`)

            /*  delete the instance  */
            let result = instance.id
            instance.destroy()

            /*  return id of deleted entity  */
            return result
        }.bind(this))
    }

    mutationEntityDeleteMany (entity) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  load entity instances  */
            let opts = this.findAllOptions(entity, args, info)
            let instances = yield (this.dm[entity].findAll(opts))
            if (instances.length === 0)
                throw new Error(`no such entities found`)

            /*  iterate over all entities  */
            let result = []
            for (let i = 0; i < instances.length; i++) {
                let instance = instances[i]

                /*  check access to target  */
                let allowed = yield (this.authorized("delete", entity, instance, ctx))
                if (!allowed)
                    return new Error(`you are not allowed to delete entity "${entity}#${instance.id}"`)

                /*  adjust the attributes according to the request  */
                result.push(instance.id)
                instance.destroy()
            }

            /*  return ids of deleted entities  */
            return result
        }.bind(this))
    }
}

