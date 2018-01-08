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
import UUID                    from "pure-uuid"
import aggregation             from "aggregation/es6"

/*  internal dependencies  */
import gtsVersion              from "./gts-1-version"
import gtsUtilHook             from "./gts-2-util-hook"
import gtsUtilGraphQL          from "./gts-3-util-graphql"
import gtsUtilSequelizeOptions from "./gts-4-util-sequelize-options"
import gtsUtilSequelizeFields  from "./gts-5-util-sequelize-fields"
import gtsUtilFTS              from "./gts-6-util-fts"
import gtsEntityQuery          from "./gts-7-entity-query"
import gtsEntityCreate         from "./gts-8-entity-create"
import gtsEntityClone          from "./gts-9-entity-clone"
import gtsEntityUpdate         from "./gts-A-entity-update"
import gtsEntityDelete         from "./gts-B-entity-delete"

/*  the API class  */
class GraphQLToolsSequelize extends aggregation(
    gtsVersion,
    gtsUtilHook,
    gtsUtilGraphQL,
    gtsUtilSequelizeOptions,
    gtsUtilSequelizeFields,
    gtsUtilFTS,
    gtsEntityQuery,
    gtsEntityCreate,
    gtsEntityClone,
    gtsEntityUpdate,
    gtsEntityDelete
) {
    constructor (sequelize, options = {}) {
        super(sequelize, options)
        this._sequelize  = sequelize
        this._models     = sequelize.models
        this._idtype     = (typeof options.idtype === "string"   ? options.idtype : "UUID")
        this._idmake     = (typeof options.idmake === "function" ? options.idmake : () => (new UUID(1)).format())
        this._anonCtx    = function (type) { this.__$type$ = type }
        this._anonCtx.prototype.isType = function (type) { return this.__$type$ === type }
    }
    boot () {
        return this._ftsBoot()
    }
}

/*  export the traditional way for interoperability reasons
    (as Babel would export an object with a 'default' field)  */
module.exports = GraphQLToolsSequelize

