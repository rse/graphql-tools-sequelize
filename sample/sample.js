
import UUID                  from "pure-uuid"
import * as GraphQL          from "graphql"
import * as GraphQLTools     from "graphql-tools"
import GraphQLToolsSequelize from "graphql-tools-sequelize"
import GraphQLToolsTypes     from "graphql-tools-types"
import HAPI                  from "hapi"
import HAPIGraphiQL          from "hapi-plugin-graphiql"
import Boom                  from "boom"
import Sequelize             from "sequelize"

;(async function () {
    /*  establish database connection  */
    let db = new Sequelize("./sample.db", "", "", {
        dialect: "sqlite", host: "", port: "", storage: "./sample.db",
        define: { freezeTableName: true, timestamps: false },
        logging: (msg) => { console.log("Sequelize: " + msg) },
    })
    await db.authenticate()

    /*  define database schema  */
    let dm = {}
    dm.OrgUnit = db.define("OrgUnit", {
        id:         { type: Sequelize.UUID,        primaryKey: true  },
        initials:   { type: Sequelize.STRING(3),   allowNull:  false },
        name:       { type: Sequelize.STRING(100), allowNull:  false }
    })
    dm.Person = db.define("Person", {
        id:         { type: Sequelize.UUID,        primaryKey: true  },
        initials:   { type: Sequelize.STRING(3),   allowNull:  false },
        name:       { type: Sequelize.STRING(100), allowNull:  false },
        role:       { type: Sequelize.STRING(30),  allowNull:  true }
    })
    dm.OrgUnit.belongsTo(dm.OrgUnit, {
        as:         "parentUnit",
        foreignKey: "parentUnitId"
    })
    dm.Person.belongsTo(dm.Person, {
        as:         "supervisor",
        foreignKey: "personId"
    })
    dm.Person.belongsTo(dm.OrgUnit, {
        as:         "belongsTo",
        foreignKey: "orgUnitId"
    })
    dm.OrgUnit.hasMany(dm.Person, {
        as:         "members",
        foreignKey: "orgUnitId"
    })
    dm.OrgUnit.hasOne(dm.Person, {
        as:         "director",
        foreignKey: "directorId"
    })

    /*  on-the-fly (re-)create database schema  */
    await db.sync({ force: true })

    /*  fill database initially  */
    const uuid = () => (new UUID(1)).format()
    const uMSG = await dm.OrgUnit.create({ id: uuid(), initials: "msg", name: "msg systems ag" })
    const uXT  = await dm.OrgUnit.create({ id: uuid(), initials: "XT",  name: "msg Applied Technology Research (XT)" })
    const uXIS = await dm.OrgUnit.create({ id: uuid(), initials: "XIS", name: "msg Information Security (XIS)" })
    const pHZ  = await dm.Person.create ({ id: uuid(), initials: "HZ",  name: "Hans Zehetmaier" })
    const pJS  = await dm.Person.create ({ id: uuid(), initials: "JS",  name: "Jens Stäcker" })
    const pRSE = await dm.Person.create ({ id: uuid(), initials: "RSE", name: "Ralf S. Engelschall" })
    const pBEN = await dm.Person.create ({ id: uuid(), initials: "BEN", name: "Bernd Endras" })
    const pCGU = await dm.Person.create ({ id: uuid(), initials: "CGU", name: "Carol Gutzeit" })
    const pMWS = await dm.Person.create ({ id: uuid(), initials: "MWS", name: "Mark-W. Schmidt" })
    const pBWE = await dm.Person.create ({ id: uuid(), initials: "BWE", name: "Bernhard Weber" })
    const pFST = await dm.Person.create ({ id: uuid(), initials: "FST", name: "Florian Stahl", role: "employee" })
    await uMSG.setDirector(pHZ)
    await uMSG.setMembers([ pHZ, pJS ])
    await uXT.setDirector(pRSE)
    await uXT.setMembers([ pRSE, pBEN, pCGU ])
    await uXT.setParentUnit(uMSG)
    await uXIS.setDirector(pMWS)
    await uXIS.setMembers([ pMWS, pBWE, pFST ])
    await uXIS.setParentUnit(uMSG)
    await pJS.setSupervisor(pHZ)
    await pRSE.setSupervisor(pJS)
    await pBEN.setSupervisor(pRSE)
    await pCGU.setSupervisor(pRSE)
    await pMWS.setSupervisor(pJS)
    await pBWE.setSupervisor(pMWS)
    await pFST.setSupervisor(pMWS)

    /*  establish GraphQL to Sequelize mapping  */
    const validator = async (/* type, obj */) => {
        return true
    }
    const authorizer = async (/* moment, op, type, obj, ctx */) => {
        return true
    }
    const gts = new GraphQLToolsSequelize(db, {
        validator:  validator,
        authorizer: authorizer,
        tracer: async (record /*, ctx */) => {
            console.log(`trace: record=${JSON.stringify(record)}`)
        },
        fts: {
            "OrgUnit": [ "name" ],
            "Person":  [ "name" ]
        }
    })
    await gts.boot()

    /*  the GraphQL schema definition  */
    let definition = `
        schema {
            query:    Root
            mutation: Root
        }
        scalar UUID
        scalar JSON
        type Root {
            ${gts.entityQuerySchema("Root", "", "OrgUnit")}
            ${gts.entityQuerySchema("Root", "", "OrgUnit*")}
            ${gts.entityQuerySchema("Root", "", "Person")}
            ${gts.entityQuerySchema("Root", "", "Person*")}
        }
        type OrgUnit {
            ${gts.attrIdSchema("OrgUnit")}
            ${gts.attrHcSchema("OrgUnit")}
            initials: String
            name: String
            director: Person
            members: [Person]!
            parentUnit: OrgUnit
            ${gts.entityCloneSchema ("OrgUnit")}
            ${gts.entityCreateSchema("OrgUnit")}
            ${gts.entityUpdateSchema("OrgUnit")}
            ${gts.entityDeleteSchema("OrgUnit")}
        }
        type Person {
            ${gts.attrIdSchema("Person")}
            ${gts.attrHcSchema("Person")}
            initials: String
            name: String
            role: Role
            belongsTo: OrgUnit
            supervisor: Person
            ${gts.entityCloneSchema ("Person")}
            ${gts.entityCreateSchema("Person")}
            ${gts.entityUpdateSchema("Person")}
            ${gts.entityDeleteSchema("Person")}
        }
        enum Role {
            principal
            employee
            assistant
        }
    `

    /*  the GraphQL schema resolvers  */
    let resolvers = {
        UUID: GraphQLToolsTypes.UUID({ name: "UUID", storage: "string" }),
        JSON: GraphQLToolsTypes.JSON({ name: "JSON" }),
        Root: {
            OrgUnit:    gts.entityQueryResolver ("Root", "", "OrgUnit"),
            OrgUnits:   gts.entityQueryResolver ("Root", "", "OrgUnit*"),
            Person:     gts.entityQueryResolver ("Root", "", "Person"),
            Persons:    gts.entityQueryResolver ("Root", "", "Person*"),
        },
        OrgUnit: {
            id:         gts.attrIdResolver      ("OrgUnit"),
            hc:         gts.attrHcResolver      ("OrgUnit"),
            director:   gts.entityQueryResolver ("OrgUnit", "director",   "Person"),
            members:    gts.entityQueryResolver ("OrgUnit", "members",    "Person*"),
            parentUnit: gts.entityQueryResolver ("OrgUnit", "parentUnit", "OrgUnit"),
            clone:      gts.entityCloneResolver ("OrgUnit"),
            create:     gts.entityCreateResolver("OrgUnit"),
            update:     gts.entityUpdateResolver("OrgUnit"),
            delete:     gts.entityDeleteResolver("OrgUnit")
        },
        Person: {
            id:         gts.attrIdResolver      ("Person"),
            hc:         gts.attrHcResolver      ("Person"),
            role:       ({ role }) => role,
            belongsTo:  gts.entityQueryResolver ("Person", "belongsTo",  "OrgUnit"),
            supervisor: gts.entityQueryResolver ("Person", "supervisor", "Person"),
            clone:      gts.entityCloneResolver ("Person"),
            create:     gts.entityCreateResolver("Person"),
            update:     gts.entityUpdateResolver("Person"),
            delete:     gts.entityDeleteResolver("Person")
        }
    }

    /*  generate executable GraphQL schema  */
    let schema = GraphQLTools.makeExecutableSchema({
        typeDefs: [ definition ],
        resolvers: resolvers,
        allowUndefinedInResolve: false,
        resolverValidationOptions: {
            requireResolversForArgs:      true,
            requireResolversForNonScalar: true,
            requireResolversForAllFields: false
        }
    })

    /*  GraphQL query  */
    let query = `
        mutation AddCoCWT {
            m1: Person {
                create(
                    id: "acf34c80-9f83-11e6-8d46-080027e303e4",
                    with: {
                        initials: "JHO",
                        name: "Jochen Hörtreiter",
                        supervisor: "${pRSE.id}"
                    }
                ) {
                    id initials name
                }
            }
            m2: OrgUnit {
                create(
                    id: "acf34c80-9f83-11e6-8d47-080027e303e4",
                    with: {
                        initials: "CoC-WT",
                        name: "CoC Web Technologies",
                        parentUnit: "${uXT.id}",
                        director: "acf34c80-9f83-11e6-8d46-080027e303e4"
                    }
                ) {
                    id initials name
                }
            }
            q1: OrgUnits(where: {
                initials: "CoC-WT"
            }) {
                id
                name
                director   { id name }
                parentUnit { id name }
                members    { id name }
            }
            u1: Person(id: "acf34c80-9f83-11e6-8d46-080027e303e4") {
                update(with: { initials: "XXX", role: "assistant" }) {
                    id initials name role
                }
            }
            c1: Person(id: "acf34c80-9f83-11e6-8d46-080027e303e4") {
                clone {
                    id initials name
                }
            }
            d1: Person(id: "acf34c80-9f83-11e6-8d46-080027e303e4") {
                delete
            }
        }
    `

    /*  setup network service  */
    let server = new HAPI.Server({
        address:  "0.0.0.0",
        port:     12345
    })

    /*  establish the HAPI route for GraphiQL UI  */
    await server.register({
        plugin: HAPIGraphiQL,
        options: {
            graphiqlURL:      "/api",
            graphqlFetchURL:  "/api",
            graphqlFetchOpts: `{
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept":       "application/json"
                },
                body: JSON.stringify(params),
                credentials: "same-origin"
            }`,
            graphqlExample: query.replace(/^\n/, "").replace(/^        /mg, "")
        }
    })

    /*  establish the HAPI route for GraphQL API  */
    server.route({
        method: "POST",
        path:   "/api",
        config: {
            payload: { output: "data", parse: true, allow: "application/json" }
        },
        handler: async (request, h) => {
            /*  determine request  */
            if (typeof request.payload !== "object" || request.payload === null)
                return Boom.badRequest("invalid request")
            let query     = request.payload.query
            let variables = request.payload.variables
            let operation = request.payload.operationName

            /*  support special case of GraphiQL  */
            if (typeof variables === "string")
                variables = JSON.parse(variables)
            if (typeof operation === "object" && operation !== null)
                return Boom.badRequest("invalid request")

            /*  wrap GraphQL operation into a database transaction  */
            return db.transaction({
                autocommit:     false,
                deferrable:     true,
                type:           Sequelize.Transaction.TYPES.DEFERRED,
                isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
            }, (tx) => {
                /*  create context for GraphQL resolver functions  */
                let ctx = { tx }

                /*  execute the GraphQL query against the GraphQL schema  */
                return GraphQL.graphql(schema, query, null, ctx, variables, operation)
            }).then((result) => {
                /*  success/commit  */
                return h.response(result).code(200)
            }).catch((result) => {
                /*  error/rollback  */
                if (typeof result === "object" && result instanceof Error)
                    result = `${result.name}: ${result.message}`
                else if (typeof result !== "string")
                    result = result.toString()
                result = { errors: [ { message: result } ] }
                return h.response(result).code(200)
            })
        }
    })

    /*  start server  */
    await server.start()
    console.log(`GraphiQL UI:  [GET]  http://${server.info.host}:${server.info.port}/api`)
    console.log(`GraphQL  API: [POST] http://${server.info.host}:${server.info.port}/api`)
})().catch((ex) => {
    console.log(`ERROR: ${ex}`)
})

