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

/*  external dependencies  */
import UUID              from "pure-uuid"
import Ducky             from "ducky"
import co                from "co"
import Promise           from "bluebird"
import capitalize        from "capitalize"
import GraphQLFields     from "graphql-fields"
import elasticlunr       from "elasticlunr"

/*  the API class  */
export default class GraphQLToolsSequelize {
    constructor (sequelize, options = {}) {
        this._sequelize  = sequelize
        this._models     = sequelize.models
        this._validator  = (typeof options.validator  === "function" ? options.validator  : null)
        this._authorizer = (typeof options.authorizer === "function" ? options.authorizer : null)
        this._tracer     = (typeof options.tracer     === "function" ? options.tracer     : null)
        this._ftsCfg     = (typeof options.fts        === "object"   ? options.fts        : null)
        this._ftsIdx     = {}
    }

    /*  bootstrap library  */
    boot () {
        return this._ftsBoot()
    }

    /*
    **  ==== HELPER METHODS ====
    */

    /*   optionally check authorization  */
    _authorized (op, type, obj, ctx) {
        if (this._authorizer === null)
            return Promise.resolve(true)
        let result
        try {
            result = this._authorizer.call(null, op, type, obj, ctx)
        }
        catch (ex) {
            result = Promise.resolve(false)
        }
        if (!(typeof result === "object" && typeof result.then === "function"))
            result = Promise.resolve(result)
        return result
    }

    /*   optionally provide tracing information  */
    _trace (type, oid, obj, op, via, onto, ctx) {
        if (this._tracer === null)
            return Promise.resolve(true)
        let result
        try {
            result = this._tracer.call(null, type, oid, obj, op, via, onto, ctx)
        }
        catch (ex) {
            result = Promise.resolve(false)
        }
        if (!(typeof result === "object" && typeof result.then === "function"))
            result = Promise.resolve(result)
        return result
    }

    /*   optionally validate attributes of entity  */
    _validate (type, obj, ctx) {
        if (this._validator === null)
            return Promise.resolve(true)
        let result = this._validator.call(null, type, obj, ctx)
        if (!(typeof result === "object" && typeof result.then === "function"))
            result = Promise.resolve(result)
        return result
    }

    /*  determine fields (and their type) of a GraphQL object type  */
    _fieldsOfGraphQLType (info, entity) {
        let fields = { attribute: {}, relation: {}, method: {} }
        let fieldsAll = info.schema._typeMap[entity]._fields
        Object.keys(fieldsAll).forEach((field) => {
            let type = fieldsAll[field].type
            while (typeof type.ofType === "object")
                type = type.ofType
            if (field.match(/^(?:clone|create|update|delete)/))
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
                    if (typeof value.set === "string")
                        value.set = [ value.set ]
                    if (typeof value.add === "string")
                        value.add = [ value.add ]
                    if (typeof value.del === "string")
                        value.del = [ value.del ]
                    if (!Ducky.validate(value, `{
                        set?: [ string* ], add?: [ string+ ], del?: [ string+ ] }`))
                        throw new Error(`invalid value for relation "${name}" on type "${entity}"`)
                    fields.relation[name] = value
                }
                else if (defined.attribute[name]) {
                    let value = args.with[name]
                    let type = info.schema._typeMap[entity]._fields[name].type
                    while (typeof type.ofType === "object")
                        type = type.ofType
                    if (   type.constructor.name === "GraphQLScalarType"
                        && typeof type.parseValue === "function"        )
                        value = type.parseValue(value)
                    else if (type.constructor.name === "GraphQLEnumType") {
                        if (typeof value !== "string")
                            throw new Error(`invalid value type (expected string) for ` +
                                `enumeration "${type.name}" on field "${name}" on type "${entity}"`)
                        if (type._enumConfig.values[value] === undefined)
                            throw new Error(`invalid value for ` +
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

    /*  GraphQL standard options to Sequelize findById() options conversion  */
    _findOneOptions (entity, args, info) {
        let opts = {}

        /*  determine allowed fields  */
        let allowed = this._fieldsOfGraphQLType(info, entity)

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

        /*  determine Sequelize "attributes" parameter  */
        let fieldInfo = GraphQLFields(info)
        let fields = Object.keys(fieldInfo)
        let attr = fields.filter((field) => allowed.attribute[field])
        let rels = fields.filter((field) => allowed.relation[field])
        if (rels.length === 0) {
            /*  in case no relationships should be followed at all from this entity,
                we can load the requested attributes only. If any relationship
                should be followed from this entity, we have to avoid
                such an attribute filter as this means that at least "hasOne" relationships
                would be "null" when dereferenced afterwards.  */
            if (attr.length === 0)
                /*  should not happen as GraphQL does not allow an entirely empty selection  */
                opts.attributes = [ this._sequelize.literal("1") ]
            else
                opts.attributes = attr
        }

        return opts
    }

    /*  GraphQL standard options to Sequelize findAll() options conversion  */
    _findManyOptions (entity, args, info) {
        let opts = {}

        /*  determine allowed fields  */
        let allowed = this._fieldsOfGraphQLType(info, entity)

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
        let fieldInfo = GraphQLFields(info)
        let fields = Object.keys(fieldInfo)
        let attr = fields.filter((field) => allowed.attribute[field])
        let rels = fields.filter((field) => allowed.relation[field])
        if (rels.length === 0) {
            /*  in case no relationships should be followed at all from this entity,
                we can load the requested attributes only. If any relationship
                should be followed from this entity, we have to avoid
                such an attribute filter as this means that at least "hasOne" relationships
                would be "null" when dereferenced afterwards.  */
            if (attr.length === 0)
                /*  should not happen as GraphQL does not allow an entirely empty selection  */
                opts.attributes = [ this._sequelize.literal("1") ]
            else
                opts.attributes = attr
        }

        return opts
    }

    /*  update all relation fields of an entity  */
    _entityUpdateFields (type, obj, def, upd, ctx) {
        return co(function * () {
            let opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            let rels = Object.keys(upd)
            for (let i = 0; i < rels.length; i++) {
                let name  = rels[i]
                let value = upd[name]
                const changeRelation = co.wrap(function * (prefix, ids) {
                    for (let j = 0; j < ids.length; j++) {
                        let id   = ids[j]
                        let type = def[name]
                        let foreign = yield (this._models[type].findById(id, opts))
                        if (foreign === null)
                            throw new Error(`no such entity ${type}#${id} found`)
                        let method = `${prefix}${capitalize(name)}`
                        if (typeof obj[method] === "function")
                            yield (obj[method](foreign, opts))
                        else if (prefix === "add" || prefix === "remove") {
                            /*  special case for 1-arity relationship!  */
                            method = `set${capitalize(name)}`
                            if (typeof obj[method] === "function")
                                yield (obj[method](prefix === "add" ? foreign : null, opts))
                            else
                                throw new Error(`relationship mutation method not found ` +
                                    `to ${prefix} relation ${name} on type ${type}`)
                        }
                    }
                }.bind(this))
                if (value.set)
                    yield (changeRelation("set",    value.set))
                if (value.del)
                    yield (changeRelation("remove", value.del))
                if (value.add)
                    yield (changeRelation("add",    value.add))
            }
        }.bind(this))
    }


    /*
    **  ==== FULL-TEXT-SEARCH (FTS) SUPPORT ====
    */

    /*  cherry-pick fields for FTS indexing  */
    _ftsObj2Doc (type, obj) {
        let id = String(obj.id)
        let doc = { id: id, __any: id }
        this._ftsCfg[type].forEach((field) => {
            let val = String(obj[field])
            doc[field] = val
            doc.__any += ` ${val}`
        })
        return doc
    }

    /*  bootstrap FTS by creating initial in-memory index  */
    _ftsBoot () {
        return co(function * () {
            /*  operate only if FTS is configured  */
            if (this._ftsCfg === null)
                return

            /*  iterate over all entity types...  */
            for (let type of Object.keys(this._ftsCfg)) {
                /*  create a new in-memory index  */
                this._ftsIdx[type] = new elasticlunr.Index()
                this._ftsIdx[type].saveDocument(false)
                this._ftsIdx[type].addField("id")
                this._ftsIdx[type].addField("__any")
                this._ftsCfg[type].forEach((field) => {
                    this._ftsIdx[type].addField(field)
                })
                this._ftsIdx[type].setRef("id")

                /*  iterate over all entity objects...  */
                let opts = { attributes: this._ftsCfg[type].concat([ "id" ]) }
                let objs = yield (this._models[type].findAll(opts))
                objs.forEach((obj) => {
                    /*  add entity objects to index  */
                    let doc = this._ftsObj2Doc(type, obj)
                    this._ftsIdx[type].addDoc(doc)
                })
            }
        }.bind(this))
    }

    /*  update the FTS index  */
    _ftsUpdate (type, oid, obj, op) {
        /*  operate only if FTS is configured  */
        if (this._ftsCfg === null)
            return
        if (this._ftsCfg[type] === undefined)
            return

        /*  dispatch according to operation  */
        if (op === "create") {
            /*  add entity to index  */
            let doc = this._ftsObj2Doc(type, obj)
            this._ftsIdx[type].addDoc(doc)
        }
        else if (op === "update") {
            /*  update entity in index  */
            let doc = this._ftsObj2Doc(type, obj)
            this._ftsIdx[type].updateDoc(doc)
        }
        else if (op === "delete") {
            /*  delete entity from index  */
            this._ftsIdx[type].removeDocByRef(oid)
        }
    }

    /*  search in the FTS index  */
    _ftsSearch (type, query, order, offset, limit, ctx) {
        /*  operate only if FTS is configured  */
        if (this._ftsCfg === null)
            return new Error(`Full-Text-Search (FTS) not available at all`)
        if (this._ftsCfg[type] === undefined)
            return new Error(`Full-Text-Search (FTS) not available for entity "${type}"`)

        /*  parse "[field:]keyword [field:]keyword [, ...]" query string  */
        let queries = []
        query.split(/\s*,\s*/).forEach((query) => {
            let fields = {}
            query.split(/\s+/).forEach((field) => {
                let fn = "__any"
                let kw = field
                let m
                if ((m = field.match(/^(.+):(.+)$/)) !== null)
                    fn = m[1], kw = m[2]
                if (fn !== "__any" && this._ftsCfg[type].indexOf(fn) < 0)
                    throw new Error(`Full-Text-Search (FTS) not available for field "${fn}" of entity "${type}"`)
                if (fields[fn] === undefined)
                    fields[fn] = []
                fields[fn].push(kw)
            })
            queries.push(fields)
        })

        /*  iterate over all queries...  */
        let results1 = {}
        queries.forEach((query) => {
            /*   iterate over all fields...  */
            let results2 = {}
            Object.keys(query).forEach((field) => {
                /*  lookup entity ids from index for particular field  */
                let kw = query[field].join(" ")
                let config = {
                    fields: {
                        [field]: {
                            boost:  1,
                            expand: true,
                            bool:   "AND"
                        }
                    }
                }
                let results = this._ftsIdx[type].search(kw, config)

                /*  reduce result list to set of unique ids  */
                let results3 = {}
                results.forEach((result) => {
                    let oid = result.ref
                    results3[oid] = true
                })

                /*  AND-combine results with previous results  */
                let oids = Object.keys(results2)
                if (oids.length === 0)
                    Object.keys(results3).forEach((oid) => {
                        results2[oid] = true
                    })
                else {
                    oids.forEach((oid) => {
                        if (!results3[oid])
                            delete results2[oid]
                    })
                }
            })

            /*  OR-combine results with previous results  */
            Object.keys(results2).forEach((oid) => {
                results1[oid] = true
            })
        })

        /*  query entity objects from database  */
        let opts = { where: { id: Object.keys(results1) } }
        if (order  !== undefined) opts.order       = order
        if (offset !== undefined) opts.offset      = offset
        if (limit  !== undefined) opts.limit       = limit
        if (ctx.tx !== undefined) opts.transaction = ctx.tx
        return this._models[type].findAll(opts)
    }

    /*
    **  ==== API METHODS ====
    */

    /*  API: query/read one or many entities (directly or via relation)  */
    entityQuerySchema (source, relation, target) {
        let m
        if ((m = target.match(/^(.+)\*$/)) !== null) {
            target = m[1]
            /*  MANY  */
            if (relation === "")
                /*  directly  */
                return `` +
                    `# Query one or many [${target}]() entities,\n` +
                    `# by either an (optionally available) full-text-search (\`query\`)\n` +
                    `# or an (always available) attribute-based condition (\`where\`),\n` +
                    `# optionally sort them (\`order\`),\n` +
                    `# optionally start the result set at the n-th entity (zero-based \`offset\`), and\n` +
                    `# optionally reduce the result set to a maximum number of entities (\`limit\`).\n` +
                    `${target}s(fts: String, where: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
            else
                /*  via relation  */
                return `` +
                    `# Query one or many [${target}]() entities\n` +
                    `# by following the **${relation}** relation of [${source}]() entity,\n` +
                    `# optionally filter them by a condition (\`where\`),\n` +
                    `# optionally sort them (\`order\`),\n` +
                    `# optionally start the result set at the n-th entity (zero-based \`offset\`), and\n` +
                    `# optionally reduce the result set to a maximum number of entities (\`limit\`).\n` +
                    `${relation}(where: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
        }
        else {
            /*  ONE  */
            if (relation === "")
                /*  directly  */
                return `` +
                    `# Query one [${target}]() entity by its unique id.\n` +
                    `${target}(id: String): ${target}\n`
            else
                /*  via relation  */
                return `` +
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
        return co.wrap(function * (parent, args, ctx, info) {
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
                        objs = yield(this._ftsSearch(target, args.fts, args.order, args.offset, args.limit, ctx))
                    else
                        /*  directly, via database  */
                        objs = yield(this._models[target].findAll(opts))
                }
                else {
                    /*  via relation  */
                    let getter = `get${capitalize(relation)}`
                    objs = yield (parent[getter](opts))
                }

                /*  check authorization  */
                objs = yield (Promise.filter(objs, (obj) => {
                    return this._authorized("read", target, obj, ctx)
                }))

                /*  trace access  */
                yield (Promise.each(objs, (obj) => {
                    return this._trace(target, obj.id, obj, "read", relation === "" ? "direct" : "relation", "many", ctx)
                }))

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
                        return this._models[target].build({})
                    obj = yield (this._models[target].findById(args.id, opts))
                }
                else {
                    /*  via relation  */
                    let getter = `get${capitalize(relation)}`
                    obj = yield (parent[getter](opts))
                }
                if (obj === null)
                    return null

                /*  check authorization  */
                if (!(yield (this._authorized("read", target, obj, ctx))))
                    return null

                /*  trace access  */
                yield (this._trace(target, obj.id, obj, "read", relation === "" ? "direct" : "relation", "one", ctx))

                return obj
            }
        }.bind(this))
    }

    /*  API: create a new entity  */
    entityCreateSchema (type) {
        return `` +
            `# Create new [${type}]() entity, optionally with specified attributes (\`with\`)\n` +
            `create(id: UUID, with: JSON): ${type}!\n`
    }
    entityCreateResolver (type) {
        return co.wrap(function * (entity, args, ctx, info) {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error(`method "create" only allowed under "mutation" operation`)
            if (entity.id !== undefined && entity.id !== null)
                throw new Error(`method "create" only allowed in anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this._fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this._fieldsOfGraphQLRequest(args, info, type)

            /*  handle unique id  */
            if (args.id === undefined)
                /*  auto-generate the id  */
                build.attribute.id = (new UUID(1)).format()
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
                defined.relation, build.relation, ctx))

            /*  check access to entity again  */
            if (!(yield (this._authorized("read", type, obj, ctx))))
                return null

            /*  update FTS index  */
            this._ftsUpdate(type, obj.id, obj, "create")

            /*  trace access  */
            yield (this._trace(type, obj.id, obj, "create", "direct", "one", ctx))

            /*  return new entity  */
            return obj
        }.bind(this))
    }

    /*  API: clone an entity (without relationships)  */
    entityCloneSchema (type) {
        return `` +
            `# Clone one [${type}]() entity by cloning its attributes (but not its relationships).\n` +
            `clone: ${type}!\n`
    }
    entityCloneResolver (type) {
        return co.wrap(function * (entity, args, ctx, info) {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error(`method "clone" only allowed under "mutation" operation`)
            if (entity.id === undefined || entity.id === null)
                throw new Error(`method "clone" only allowed in non-anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this._fieldsOfGraphQLType(info, type)

            /*  check access to parent entity  */
            if (!(yield (this._authorized("read", type, entity, ctx))))
                throw new Error(`not allowed to read entity of type "${type}"`)

            /*  build a new entity  */
            let data = {}
            data.id = (new UUID(1)).format()
            Object.keys(defined.attribute).forEach((attr) => {
                if (attr !== "id")
                    data[attr] = parent[attr]
            })
            let obj = this._models[type].build(data)

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

            /*  check access to entity again  */
            if (!(yield (this._authorized("read", type, obj, ctx))))
                return null

            /*  update FTS index  */
            this._ftsUpdate(type, obj.id, obj, "create")

            /*  trace access  */
            yield (this._trace(type, obj.id, obj, "create", "direct", "one", ctx))

            /*  return new entity  */
            return obj
        }.bind(this))
    }

    /*  API: update an entity  */
    entityUpdateSchema (type) {
        return `` +
            `# Update one [${type}]() entity with specified attributes (\`with\`).\n` +
            `update(with: JSON!): ${type}!\n`
    }
    entityUpdateResolver (type) {
        return co.wrap(function * (entity, args, ctx, info) {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error(`method "update" only allowed under "mutation" operation`)
            if (entity.id === undefined || entity.id === null)
                throw new Error(`method "update" only allowed in non-anonymous ${type} context`)

            /*  determine fields of entity as defined in GraphQL schema  */
            let defined = this._fieldsOfGraphQLType(info, type)

            /*  determine fields of entity as requested in GraphQL request  */
            let build = this._fieldsOfGraphQLRequest(args, info, type)

            /*  check access to entity  */
            if (!(yield (this._authorized("update", type, entity, ctx))))
                throw new Error(`not allowed to update entity of type "${type}"`)

            /*  validate attributes  */
            yield (this._validate(type, build.attribute, ctx))

            /*  adjust the attributes according to the request  */
            let opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            entity.update(build.attribute, opts)

            /*  adjust the relationships according to the request  */
            yield (this._entityUpdateFields(type, entity,
                defined.relation, build.relation, ctx))

            /*  check access to entity again  */
            if (!(yield (this._authorized("read", type, entity, ctx))))
                return null

            /*  update FTS index  */
            this._ftsUpdate(type, entity.id, entity, "update")

            /*  trace access  */
            yield (this._trace(type, entity.id, entity, "update", "direct", "one", ctx))

            /*  return updated entity  */
            return entity
        }.bind(this))
    }

    /*  API: delete an entity  */
    entityDeleteSchema (type) {
        return `` +
            `# Delete one [${type}]() entity.\n` +
            `delete: UUID!\n`
    }
    entityDeleteResolver (type) {
        return co.wrap(function * (entity, args, ctx, info) {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error(`method "delete" only allowed under "mutation" operation`)
            if (entity.id === undefined || entity.id === null)
                throw new Error(`method "delete" only allowed in non-anonymous ${type} context`)

            /*  check access to target  */
            if (!(yield (this._authorized("delete", type, entity, ctx))))
                return new Error(`not allowed to delete entity of type "${type}"`)

            /*  delete the instance  */
            let opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx
            let result = entity.id
            yield (entity.destroy(opts))

            /*  update FTS index  */
            this._ftsUpdate(type, result, null, "delete")

            /*  trace access  */
            yield (this._trace(type, result, null, "delete", "direct", "one", ctx))

            /*  return id of deleted entity  */
            return result
        }.bind(this))
    }
}

