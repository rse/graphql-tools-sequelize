/*
**  GraphQL-Tools-Sequelize -- Integration of GraphQL-Tools and Sequelize ORM
**  Copyright (c) 2016-2020 Dr. Ralf S. Engelschall <rse@engelschall.com>
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
    /*  determine Sequelize operators  */
    _sequelizeOpMap () {
        const map = {}
        const symbols = this._sequelize.queryInterface.queryGenerator.OperatorMap
        for (const symbol of Object.getOwnPropertySymbols(symbols))
            map[symbol.description] = symbol
        return map
    }

    /*  build Sequelize "where" parameter  */
    _buildWhere (entity, src, allowed, opMap) {
        /*  pass-through non-object sources (end of recursion)  */
        if (typeof src !== "object")
            return src

        /*  build destination parameter  */
        let dst
        if (src instanceof Array) {
            dst = []
            for (const value of src)
                dst.push(this._buildWhere(entity, value, allowed, opMap))  /*  RECURSION  */
        }
        else {
            dst = {}
            for (const key of Object.keys(src)) {
                if (opMap[key] !== undefined)
                    dst[opMap[key]] = this._buildWhere(entity, src[key], allowed, opMap)
                else if (allowed.attribute[key])
                    dst[key] = this._buildWhere(entity, src[key], allowed, opMap)
                else
                    throw new Error(`invalid "where" argument: no such field "${key}" on type "${entity}"`)
            }
        }
        return dst
    }

    /*  build Sequelize "include" parameter  */
    _buildInclude (entity, src, allowed, opMap) {
        /*  sanity check source  */
        if (src instanceof Array)
            throw new Error("invalid \"include\" argument (object expected)")

        /*  build destination parameter  */
        const dst = []
        for (const key of Object.keys(src)) {
            if (allowed.relation[key] === undefined)
                throw new Error(`invalid "include" argument: no such relation "${key}" on type "${entity}"`)
            dst.push({
                model: this._models[allowed.relation[key]],
                as:    key,
                where: this._buildWhere(entity, src[key], allowed, opMap)
            })
        }
        return dst
    }

    /*  GraphQL standard options to Sequelize findByPk() options conversion  */
    _findOneOptions (entity, args, info) {
        const opts = {}

        /*  determine allowed fields  */
        const allowed = this._fieldsOfGraphQLType(info, entity)

        /*  determine Sequelize operator map  */
        const opMap = this._sequelizeOpMap()

        /*  determine Sequelize "where" parameter  */
        if (args.where !== undefined) {
            if (typeof args.where !== "object")
                throw new Error("invalid \"where\" argument (object expected)")
            opts.where = this._buildWhere(entity, args.where, allowed, opMap)
        }

        /*  determine Sequelize "include" parameter  */
        if (args.include !== undefined) {
            if (typeof args.include !== "object")
                throw new Error("invalid \"include\" argument (object expected)")
            opts.include = this._buildInclude(entity, args.include, allowed, opMap)
        }

        /*  determine Sequelize "attributes" parameter  */
        const fieldInfo = this._graphqlRequestedFields(info)
        const fields = Object.keys(fieldInfo)
        const meth = fields.filter((field) => allowed.method[field])
        const attr = fields.filter((field) => allowed.attribute[field])
        const rels = fields.filter((field) => allowed.relation[field])
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
        const opts = {}

        /*  determine allowed fields  */
        const allowed = this._fieldsOfGraphQLType(info, entity)

        /*  determine Sequelize operator map  */
        const opMap = this._sequelizeOpMap()

        /*  determine Sequelize "where" parameter  */
        if (args.where !== undefined) {
            if (typeof args.where !== "object")
                throw new Error("invalid \"where\" argument (object expected)")
            opts.where = this._buildWhere(entity, args.where, allowed, opMap)
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
            opts.include = this._buildInclude(entity, args.include, allowed, opMap)
        }

        /*  determine Sequelize "attributes" parameter  */
        const fieldInfo = this._graphqlRequestedFields(info)
        const fields = Object.keys(fieldInfo)
        const meth = fields.filter((field) => allowed.method[field])
        const attr = fields.filter((field) => allowed.attribute[field])
        const rels = fields.filter((field) => allowed.relation[field])
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

