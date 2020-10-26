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

/*  the mixin class  */
import Ducky from "ducky"

export default class gtsEntityBatch {
    /*  API: batch for a entity or its composition/s  */
    entityBatchSchema (type) {
        return "" +
            `# Run a batch with create, clone, update or delete operation for type [${type}]() or composition entities\n` +
            `batch(collection: JSON): ${type}\n`
    }
    entityBatchResolver (type) {
        return async (entity, args, ctx, info) => {
            /*  sanity check usage context  */
            if (info && info.operation && info.operation.operation !== "mutation")
                throw new Error("method \"batch\" only allowed under \"mutation\" operation")

            /*  check anonymous context (method batch is allowed in anonymous AND non-anonymous context)  */
            let isAnonymous = true
            if (!(typeof entity === "object" && entity instanceof this._anonCtx && entity.isType(type)))
                isAnonymous = false

            /*  define validations fpr operations  */
            const createValidation = "{ op: string, type: string, id?: string, root?: boolean, ref?: string, with: object }"
            const cloneValidation  = "{ op: string, type: string, id:  string, root?: boolean, ref?: string }"
            const updateValidation = "{ op: string, type: string, id:  string, root?: boolean,              with: object }"
            const deleteValidation = "{ op: string, type: string, id:  string, root?: boolean }"

            const opts = {}
            if (ctx.tx !== undefined)
                opts.transaction = ctx.tx

            const refs = {}
            const batchArray = args.collection

            for (let i = 0; i < batchArray.length; i++) {
                const batchObj = batchArray[i]

                /*  Resolve references  */
                if (batchObj.with !== undefined) {
                    for (const ref in refs) {
                        for (const key in batchObj.with) {
                            if (batchObj.with[key] === ref)
                                batchObj.with[key] = refs[ref]
                        }
                    }
                }

                if (batchObj.op === "CREATE") {
                    if (!Ducky.validate(batchObj, createValidation))
                        throw new Error(`invalid argument for method "batch": argument collection object with type "CREATE" must have the structure: ${createValidation}`)

                    /*  create a new entity and remember entity  */
                    batchObj.entity = await this._entityCreate(batchObj.type, entity, batchObj, ctx, info)

                    /*  if there are references, remember them for resolving later  */
                    if (batchObj.ref !== undefined)
                        if (refs[batchObj.ref] === undefined)
                            refs[batchObj.ref] = batchObj.entity.id
                        else
                            throw new Error(`reference "${batchObj.ref}" already exists, but it must be unique in one batch.`)
                }
                else if (batchObj.op === "CLONE") {
                    if (!Ducky.validate(batchObj, cloneValidation))
                        throw new Error(`invalid argument for method "batch": argument collection object with type "CLONE" must have the structure: ${cloneValidation}`)

                    /*  find and clone entity and remember entity  */
                    const entityObj =  await this._models[batchObj.type].findByPk(batchObj.id, opts)
                    batchObj.entity = await this._entityClone(batchObj.type, entityObj, batchObj, ctx, info)

                    /*  if there are references, remember them for resolving later  */
                    if (batchObj.ref !== undefined)
                        if (refs[batchObj.ref] === undefined)
                            refs[batchObj.ref] = batchObj.entity.id
                        else
                            throw new Error(`reference "${batchObj.ref}" already exists, but it must be unique in one batch.`)
                }
                else if (batchObj.op === "UPDATE") {
                    if (!Ducky.validate(batchObj, updateValidation))
                        throw new Error(`invalid argument for method "batch": argument collection object with type "UPDATE" must have the structure: ${updateValidation}`)

                    /*  find and update entity and remember entity  */
                    const entityObj =  await this._models[batchObj.type].findByPk(batchObj.id, opts)
                    await this._entityUpdate(batchObj.type, entityObj, batchObj, ctx, info)
                    batchObj.entity = entityObj
                }
                else if (batchObj.op === "DELETE") {
                    if (!Ducky.validate(batchObj, deleteValidation))
                        throw new Error(`invalid argument for method "batch": argument collection object with type "DELETE" must have the structure: ${deleteValidation}`)

                    /*  find and delete entity and remember id  */
                    const entityObj =  await this._models[batchObj.type].findByPk(batchObj.id, opts)
                    await this._entityDelete(batchObj.type, entityObj, args, ctx, info)
                    batchObj.entity = null
                }
                else
                    throw new Error(`invalid operation "${batchObj.op}". Operation must be "CREATE", "CLONE", "UPDATE" or "DELETE".`)
            }

            /*  find result depending on anonymous or non-anonymous context  */
            let result = null
            if (isAnonymous) {
                const root = batchArray.find((batchObj) => { return batchObj.root })
                const firstInArray = batchArray.find((batchObj) => { return batchObj.type === type })
                if (root !== undefined)
                    result = root.entity
                else if (firstInArray !== undefined)
                    result = firstInArray.entity
            }
            else {
                /*  if non-anonymous context result is entity of given context, no matter if it was changed  */
                if (batchArray.find((batchObj) => { return batchObj.id === entity.id && batchObj.op === "DELETE" }))
                    result = null
                else
                    result = await this._models[type].findByPk(entity.id, opts)
            }

            /*  return result entity  */
            return result
        }
    }
}

