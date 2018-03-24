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
import Ducky from "ducky"

/*  the mixin class  */
export default class gtsUtilSequelizeOptions {
    /*  GraphQL standard options to Sequelize findById() options conversion  */
    _findOneOptions (entity, args, info) {
        let opts = {}

        /*  determine allowed fields  */
        let allowed = this._fieldsOfGraphQLType(info, entity)

        /*  determine Sequelize "where" parameter  */
        if (args.where !== undefined) {
            if (typeof args.where !== "object")
                throw new Error("invalid \"where\" argument (object expected)")
            opts.where = args.where
            opts.where = {}
            Object.keys(args.where).forEach((field) => {
                if (!allowed.attribute[field])
                    throw new Error("invalid \"where\" argument: " +
                        `no such field "${field}" on type "${entity}"`)
                opts.where[field] = args.where[field]
            })
        }

        /*  determine Sequelize "include" parameter  */
        if (args.include !== undefined) {
            if (typeof args.include !== "object")
                throw new Error("invalid \"include\" argument (object expected)")
            opts.include = args.include
        }

        /*  determine Sequelize "attributes" parameter  */
        let fieldInfo = this._graphqlRequestedFields(info)
        let fields = Object.keys(fieldInfo)
        let meth = fields.filter((field) => allowed.method[field])
        let attr = fields.filter((field) => allowed.attribute[field])
        let rels = fields.filter((field) => allowed.relation[field])
        if (   args[this._hcname] === undefined
            && fieldInfo[this._hcname] === undefined
            && meth.length === 0
            && rels.length === 0
            && attr.filter((a) => !this._models[entity].rawAttributes[a]).length === 0) {
            /*  in case no relationships should be followed at all from this entity,
                we can load the requested attributes only. If any relationship
                should be followed from this entity, we have to avoid
                such an attribute filter, as this means that at least "hasOne" relationships
                would be "null" when dereferenced afterwards.  */
            if (attr.length === 0)
                /*  special case of plain method calls (neither attribute nor relationship)  */
                opts.attributes = [ this._idname ]
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
                throw new Error("invalid \"where\" argument (object expected)")
            opts.where = args.where
            opts.where = {}
            Object.keys(args.where).forEach((field) => {
                if (!allowed.attribute[field])
                    throw new Error("invalid \"where\" argument: " +
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
            if (!Ducky.validate(args.order, "( string | [ (string | [ string, string ])+ ])"))
                throw new Error("invalid \"order\" argument: wrong structure")
            opts.order = args.order
        }

        /*  determine Sequelize "include" parameter  */
        if (args.include !== undefined) {
            if (typeof args.include !== "object")
                throw new Error("invalid \"include\" argument (object expected)")
            opts.include = args.include
        }

        /*  determine Sequelize "attributes" parameter  */
        let fieldInfo = this._graphqlRequestedFields(info)
        let fields = Object.keys(fieldInfo)
        let meth = fields.filter((field) => allowed.method[field])
        let attr = fields.filter((field) => allowed.attribute[field])
        let rels = fields.filter((field) => allowed.relation[field])
        if (   fieldInfo[this._hcname] === undefined
            && meth.length === 0
            && rels.length === 0
            && attr.filter((a) => !this._models[entity].rawAttributes[a]).length === 0) {
            /*  in case no relationships should be followed at all from this entity,
                we can load the requested attributes only. If any relationship
                should be followed from this entity, we have to avoid
                such an attribute filter, as this means that at least "hasOne" relationships
                would be "null" when dereferenced afterwards.  */
            if (attr.length === 0)
                /*  should not happen as GraphQL does not allow an entirely empty selection  */
                opts.attributes = [ this._idname ]
            else
                opts.attributes = attr
        }

        return opts
    }
}

