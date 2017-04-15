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

/* global module: true */
module.exports = function (grunt) {
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks("grunt-babel");
    grunt.loadNpmTasks("grunt-mocha-test");
    grunt.loadNpmTasks("grunt-eslint");

    grunt.initConfig({
        eslint: {
            options: {
                configFile: "eslint.yaml"
            },
            "graphql-tools-sequelize": [ "src/**/*.js", "tst/**/*.js" ]
        },
        babel: {
            "graphql-tools-sequelize": {
                files: [
                    {
                        expand: true,
                        cwd:    "src/",
                        src:    [ "*.js" ],
                        dest:   "lib/"
                    }
                ],
                options: {
                    sourceMap: false,
                    presets: [
                        [ "env", {
                            "targets": {
                                "node": 6.0
                            }
                        } ],
                        "es2016",
                        "es2017",
                        "stage-3",
                        "stage-2"
                    ],
                    plugins: [
                        [ "transform-runtime", {
                            "helpers":     true,
                            "polyfill":    true,
                            "regenerator": true,
                            "moduleName": "babel-runtime"
                        } ]
                    ]
                }
            }
        },
        mochaTest: {
            "graphql-tools-sequelize": {
                src: [ "tst/*.js", "!tst/common.js" ]
            },
            options: {
                reporter: "spec",
                require: "tst/common.js"
            }
        },
        clean: {
            clean: [ "lib" ],
            distclean: [ "node_modules" ]
        },
        watch: {
            "src": {
                files: [ "src/**/*.js", "tst/**/*.js" ],
                tasks: [ "default" ],
                options: {}
            }
        }
    });

    grunt.registerTask("default", [ "eslint", "babel", "mochaTest" ]);
    grunt.registerTask("test", [ "mochaTest" ]);
    grunt.registerTask("dev", [ "default", "watch" ]);
};

