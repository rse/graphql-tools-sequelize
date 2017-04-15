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
import co          from "co"
import elasticlunr from "elasticlunr"

/*  the API class  */
export default class gtsUtilFTS {
    /*  initialize the mixin  */
    initializer () {
        /*  NO-OP  */
    }

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
}

