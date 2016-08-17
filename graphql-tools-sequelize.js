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
import GraphQLFields     from "graphql-fields"

export default class GraphQLToolsSequelize {
    constructor (sequelize, authorizers = null, tracer = null) {
        this.sequelize   = sequelize
        this.models      = sequelize.models
        this.authorizers = authorizers
        this.tracer      = tracer
    }

    /*   optionally check authorization  */
    authorized (op, type, obj, ctx) {
        if (this.authorizers === null)
            return Promise.resolve(true)
        if (this.authorizers[type] === undefined)
            return Promise.resolve(true)
        let result
        try { result = this.authorizers[type](op, obj, ctx) }
        catch (ex) { result = Promise.reject(ex) }
        if (typeof result === "boolean")
            result = Promise.resolve(result)
        return result
    }

    /*   optionally give tracer a hint  */
    trace (oid, type, op, via, onto) {
        if (this.tracer === null)
            return Promise.resolve()
        let result = this.tracer.call(null, oid, type, op, via, onto)
        if (!(typeof result === "object" && typeof result.then === "function"))
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
        let found = scalarTypeMap.find((item) => item[from] === type)
        if (found !== undefined)
            found = found[to]
        return found
    }

    /*  determine fields (and their type) of a GraphQL object type  */
    fieldsOfGraphQLType (info, entity) {
        let fields = { attribute: {}, relation: {} }
        let fieldsAll = info.schema._typeMap[entity]._fields
        Object.keys(fieldsAll).forEach((field) => {
            let type = fieldsAll[field].type
            while (typeof type.ofType === "object")
                type = type.ofType
            if (type.constructor.name === "GraphQLScalarType")
                fields.attribute[field] = type.name
            else if (type.constructor.name === "GraphQLObjectType")
                fields.relation[field] = type.name
            else
                throw new Error(`unknown type "${type.constructor.name}" for field "${field}"`)
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

    /*  API: direct query single entity by id  */
    queryEntityOne (type) {
        return co.wrap(function * (parent, args, ctx) {
            /*  find entity  */
            let obj = yield (this.models[type].findById(args.id))
            if (obj === null)
                return null

            /*  check authorization  */
            if (!(yield (this.authorized("read", type, obj, ctx))))
                return null

            /*  trace access  */
            yield (this.trace(obj.id, type, "read", "direct", "one"))

            return obj
        }.bind(this))
    }

    /*  API: direct query all entities by where  */
    queryEntityAll (type) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  find entities  */
            let opts = this.findAllOptions(type, args, info)
            let objs = yield(this.models[type].findAll(opts))

            /*  check authorizations  */
            objs = yield (Promise.filter(objs, (obj) => {
                return this.authorized("read", type, obj, ctx)
            }))

            /*  trace access  */
            yield (Promise.each(objs, (obj) => {
                return this.trace(obj.id, type, "read", "direct", "all")
            }))

            return objs
        }.bind(this))
    }

    /*  API: direct query single entity by 1-ariy relationship  */
    queryRelationOne (type, getter) {
        return co.wrap(function * (parent, args, ctx) {
            /*  find entity  */
            let obj = yield(parent[getter]())
            if (obj === null)
                return null

            /*  check authorization  */
            if (!(yield (this.authorized("read", type, obj, ctx))))
                return null

            /*  trace access  */
            yield (this.trace(obj.id, type, "read", "relation", "all"))

            return obj
        }.bind(this))
    }

    /*  API: direct query all entities by N-ariy relationship  */
    queryRelationMany (type, getter) {
        return co.wrap(function * (parent, args, ctx) {
            /*  find entities  */
            let objs = yield (parent[getter]())

            /*  check authorization  */
            objs = yield (Promise.filter(objs, (obj) => {
                return this.authorized("read", type, obj, ctx)
            }))

            /*  trace access  */
            yield (Promise.each(objs, (obj) => {
                return this.trace(obj.id, type, "read", "relation", "all")
            }))

            return objs
        }.bind(this))
    }

    /*  update all relation fields of an entity  */
    mutationEntityUpdateFields (type, obj, def, upd) {
        return co(function * () {
            for (let i = 0; i < upd.length; i++) {
                let name = upd[i]
                const changeRelation = co.wrap(function * (prefix, ids) {
                    for (let j = 0; j < ids.length; j++) {
                        let type = def[name]
                        let foreign = yield (this.models[type].findById(ids[j]))
                        yield (obj[`${prefix}${capitalize(name)}`](foreign))
                    }
                }.bind(this))
                if (upd[name].$set)
                    yield (changeRelation("set",    upd[name].$set))
                if (upd[name].$del)
                    yield (changeRelation("remove", upd[name].$del))
                if (upd[name].$add)
                    yield (changeRelation("add",    upd[name].$add))
            }
        }.bind(this))
    }

    /*  API: direct create a single entity  */
    mutationEntityCreate (type) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this.fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this.fieldsOfGraphQLRequest(args, info, type)

            /*  handle unique id  */
            if (build.attribute.id === undefined)
                /*  auto-generate the id  */
                build.attribute.id = (new UUID(1)).format()
            else {
                /*  ensure the id is unique  */
                let existing = yield (this.models[type].findById(build.attribute.id))
                if (existing !== null)
                    throw new Error(`entity ${type}#${build.attribute.id} already exists`)
            }

            /*  build a new entity  */
            let obj = this.models[type].build(build.attribute)

            /*  check access to entity  */
            if (!(yield (this.authorized("create", type, obj, ctx))))
                throw new Error(`not allowed to create entity of type "${type}"`)

            /*  save new entity  */
            let err = yield (obj.save().catch((err) => err))
            if (typeof err === "object" && err instanceof Error)
                throw new Error("Sequelize: save: " + err.message + ":" +
                    err.errors.map((e) => e.message).join("; "))

            /*  post-adjust the relationships according to the request  */
            yield (this.mutationEntityUpdateFields(type, obj,
                defined.relation, build.relation))

            /*  check access to entity again  */
            if (!(yield (this.authorized("read", type, obj, ctx))))
                return null

            /*  trace access  */
            yield (this.trace(obj.id, type, "create", "direct", "one"))

            /*  return new entity  */
            return obj
        }.bind(this))
    }

    /*  API: direct update a single entity  */
    mutationEntityUpdateOne (type) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this.fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this.fieldsOfGraphQLRequest(args, info, type)

            /*  load entity instance  */
            let obj = yield (this.models[type].findById(args.id))
            if (obj === null)
                throw new Error(`entity ${type}#${args.id} not found`)

            /*  check access to entity  */
            if (!(yield (this.authorized("update", type, obj, ctx))))
                throw new Error(`not allowed to update entity of type "${type}"`)

            /*  adjust the attributes according to the request  */
            obj.update(build.attribute)

            /*  adjust the relationships according to the request  */
            yield (this.mutationEntityUpdateFields(type, obj,
                defined.relation, build.relation))

            /*  check access to entity again  */
            if (!(yield (this.authorized("read", type, obj, ctx))))
                return null

            /*  trace access  */
            yield (this.trace(obj.id, type, "update", "direct", "one"))

            /*  return updated entity  */
            return obj
        }.bind(this))
    }

    /*  API: direct update of multiple entities  */
    mutationEntityUpdateMany (type) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this.fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this.fieldsOfGraphQLRequest(args, info, type)

            /*  load entity instances  */
            let opts = this.findAllOptions(type, args, info)
            let objs = yield (this.models[type].findAll(opts))
            if (objs.length === 0)
                throw new Error(`no such entities of type "${type}" found`)

            /*  iterate over all entities  */
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i]

                /*  check access to entity  */
                if (!(yield (this.authorized("update", type, obj, ctx))))
                    return new Error(`not allowed to update entity of type "${type}"`)

                /*  adjust the attributes according to the request  */
                obj.update(build.attribute)

                /*  adjust the relationships according to the request  */
                yield (this.mutationEntityUpdateFields(type, obj,
                    defined.relation, build.relation))
            }

            /*  check access to entities again  */
            objs = yield (Promise.filter(objs, (instance) => {
                return this.authorized("read", type, instance, ctx)
            }))

            /*  trace access  */
            yield (Promise.each(objs, (obj) => {
                return this.trace(obj.id, type, "update", "direct", "many")
            }))

            /*  return updated entites  */
            return objs
        }.bind(this))
    }

    /*  API: direct delete a single entity  */
    mutationEntityDeleteOne (type) {
        return co.wrap(function * (parent, args, ctx /*, info */) {
            /*  load entity instance  */
            let obj = yield (this.models[type].findById(args.id))
            if (obj === null)
                throw new Error(`entity ${type}#${args.id} not found`)

            /*  check access to target  */
            if (!(yield (this.authorized("delete", type, obj, ctx))))
                return new Error(`not allowed to delete entity of type "${type}"`)

            /*  delete the instance  */
            let result = obj.id
            obj.destroy()

            /*  trace access  */
            yield (this.trace(result, type, "delete", "direct", "one"))

            /*  return id of deleted entity  */
            return result
        }.bind(this))
    }

    /*  API: direct delete multiple entities  */
    mutationEntityDeleteMany (type) {
        return co.wrap(function * (parent, args, ctx, info) {
            /*  load entity instances  */
            let opts = this.findAllOptions(type, args, info)
            let objs = yield (this.models[type].findAll(opts))
            if (objs.length === 0)
                throw new Error(`no such entities of type "${type}" found`)

            /*  iterate over all entities  */
            let result = []
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i]

                /*  check access to entity  */
                if (!(yield (this.authorized("delete", type, obj, ctx))))
                    throw new Error(`not allowed to delete entity "${type}#${obj.id}"`)

                /*  adjust the attributes according to the request  */
                result.push(obj.id)
                obj.destroy()
            }

            /*  trace access  */
            yield (Promise.each(result, (id) => {
                return this.trace(id, type, "delete", "direct", "many")
            }))

            /*  return ids of deleted entities  */
            return result
        }.bind(this))
    }
}

