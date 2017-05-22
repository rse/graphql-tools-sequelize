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

/*  the mixin class  */
export default class gtsUtilHook {
    /*  mixin initialization  */
    initializer (sequelize, options) {
        this._validator  = (typeof options.validator  === "function" ? options.validator  : null)
        this._authorizer = (typeof options.authorizer === "function" ? options.authorizer : null)
        this._tracer     = (typeof options.tracer     === "function" ? options.tracer     : null)
    }

    /*   optionally check authorization  */
    _authorized (moment, op, type, obj, ctx) {
        if (this._authorizer === null)
            return Promise.resolve(true)
        let result
        try {
            result = this._authorizer.call(null, moment, op, type, obj, ctx)
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
}

