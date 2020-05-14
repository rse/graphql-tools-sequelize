
GraphQL-Tools-Sequelize
========================

Integration of [GraphQL-Tools](https://github.com/apollostack/graphql-tools) and
[Sequelize](http://sequelizejs.com) Object-Relational-Mapper (ORM).

<p/>
<img src="https://nodei.co/npm/graphql-tools-sequelize.png?downloads=true&stars=true" alt=""/>

<p/>
<img src="https://david-dm.org/rse/graphql-tools-sequelize.png" alt=""/>

About
-----

This [Node.js](https://nodejs.org) module provides an integration of
the [GraphQL.js](https://github.com/graphql/graphql-js) wrapper
[GraphQL-Tools](https://github.com/apollostack/graphql-tools) and the
[Sequelize](http://sequelizejs.com) Object-Relational-Mapper (ORM) in order to operate on
the entities and their relationships of an underlying RDBMS through [GraphQL](http://graphql.org/).
It provides functions for GraphQL schema definition entries and their corresponding resolver functions
for querying and mutating entities and their relationships through GraphQL in a natural
Object-Oriented (OO) way. It optionally provides Full-Text-Search (FTS) functionality
through [ElasticLunr](http://elasticlunr.com/) and validation, authorization and tracing hooks.
It provides an elaborate CRUD (Create, Read, Update, Delete) functionality for the entities and
their relationships.

Installation
------------

```shell
$ npm install \
  graphql \
  graphql-tools \
  graphql-tools-types \
  graphql-tools-sequelize \
  sequelize \
  --save-dev
```

Usage
-----

Suppose we have a simple domain model, consisting of the two
entities `OrgUnit` and `Person` and some relationships between them
(in UML Class Diagram notation):

```txt
 parentUnit                           supervisor
 +------+                             +------+
 |      |                             |      |
 |      V 0..1                   0..1 V      |
 |   +-----------+           +-----------+   |
 +---| OrgUnit   |  belongsTo| Person    |---+
     |-----------|<----------|-----------|
     | id        |           | id        |
     | initials  |--------->*| initials  |
     | name      |  members  | name      |
     +-----------+           +-----------+
               |                 ^
               |     director    |
               +-----------------+
```

With Sequelize ORM this could be defined on the RDBMS level as:

```js
import Sequelize from "sequelize"

const db = new Sequelize(...)
const dm = {}

dm.OrgUnit = db.define("OrgUnit", {
    id:         { type: Sequelize.UUID,        primaryKey: true  },
    initials:   { type: Sequelize.STRING(3),   allowNull:  false },
    name:       { type: Sequelize.STRING(100), allowNull:  false }
})
dm.Person = db.define("Person", {
    id:         { type: Sequelize.UUID,        primaryKey: true  },
    initials:   { type: Sequelize.STRING(3),   allowNull:  false },
    name:       { type: Sequelize.STRING(100), allowNull:  false }
})
dm.OrgUnit.belongsTo(dm.OrgUnit, { as: "parentUnit", foreignKey: "parentUnitId" })
dm.Person .belongsTo(dm.Person,  { as: "supervisor", foreignKey: "personId"     })
dm.Person .belongsTo(dm.OrgUnit, { as: "belongsTo",  foreignKey: "orgUnitId"    })
dm.OrgUnit.hasMany  (dm.Person,  { as: "members",    foreignKey: "orgUnitId"    })
dm.OrgUnit.hasOne   (dm.Person,  { as: "director",   foreignKey: "directorId"   })
```

You then establish a GraphQL-to-Sequelize mapping like this:

```js
import GraphQLToolsSequelize from "graphql-tools-sequelize"

const gts = new GraphQLToolsSequelize(db)
await gts.boot()
```

Now you can use this mapping and its factory functions to conveniently
create a GraphQL schema definition as the interface for operating on
your domain model:

```js
const definition = `
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
        belongsTo: OrgUnit
        supervisor: Person
        ${gts.entityCloneSchema ("Person")}
        ${gts.entityCreateSchema("Person")}
        ${gts.entityUpdateSchema("Person")}
        ${gts.entityDeleteSchema("Person")}
    }
`
```

You also use it and its factory functions to define the corresponding
GraphQL resolver functions:

```js
import GraphQLToolsTypes from "graphql-tools-types"

const resolvers = {
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
        belongsTo:  gts.entityQueryResolver ("Person", "belongsTo",  "OrgUnit"),
        supervisor: gts.entityQueryResolver ("Person", "supervisor", "Person"),
        clone:      gts.entityCloneResolver ("Person"),
        create:     gts.entityCreateResolver("Person"),
        update:     gts.entityUpdateResolver("Person"),
        delete:     gts.entityDeleteResolver("Person")
    }
}
```

Then you use the established schema definition and resolver functions to
generate an executable GraphQL schema with the help of GraphQL-Tools:

```js
import * as GraphQLTools from "graphql-tools"

const schema = GraphQLTools.makeExecutableSchema({
    typeDefs: [ definition ],
    resolvers: resolvers
})
```

Finally, you now can execute GraphQL queries against your RDBMS:

```js
const query = `query { OrgUnits { name } }`
const variables = {}

GraphQL.graphql(schema, query, null, null, variables).then((result) => {
    console.log("OK", util.inspect(result, { depth: null, colors: true }))
}).catch((result) => {
    console.log("ERROR", result)
})
```

The following GraphQL mutation is a more elaborate example of how
CRUD operations look like and what is possible:

```txt
mutation {
    m1: Person {
        c1: create(id: "c9965340-a6c8-11e6-ac95-080027e303e4", with: {
            initials:   "BB",
            name:       "Big Boss"
        }) { id }
        c2: create(id: "ca1ace2c-a6c8-11e6-8ef0-080027e303e4", with: {
            initials:   "JD",
            name:       "John Doe",
            supervisor: "c9965340-a6c8-11e6-ac95-080027e303e4"
        }) { id }
    }
    m2: OrgUnit {
        c1: create(id: "ca8c588a-a6c8-11e6-8f19-080027e303e4", with: {
            initials: "EH",
            name:     "Example Holding",
            director: "c9965340-a6c8-11e6-ac95-080027e303e4"
        }) { id }
        c2: create(id: "cabaa4ce-a6c8-11e6-9d6d-080027e303e4", with: {
            initials:   "EC",
            name:       "Example Corporation",
            parentUnit: "ca8c588a-a6c8-11e6-8f19-080027e303e4",
            director:   "ca1ace2c-a6c8-11e6-8ef0-080027e303e4",
            members: { set: [
                "c9965340-a6c8-11e6-ac95-080027e303e4",
                "ca1ace2c-a6c8-11e6-8ef0-080027e303e4"
            ] }
        }) { id }
    }
    q1: OrgUnits(where: {
        initials: "EC"
    }) {
        name
        director   { initials name }
        members    { initials name }
        parentUnit {
            name
            director   { initials name }
            members    { initials name }
        }
    }
    m3: Person(id: "c9965340-a6c8-11e6-ac95-080027e303e4") {
        update(with: { initials: "XXX" }) {
            id initials name
        }
    }
    c1: Person(id: "c9965340-a6c8-11e6-ac95-080027e303e4") {
        clone {
            id initials name
        }
    }
    m4: Person(id: "c9965340-a6c8-11e6-ac95-080027e303e4") {
        delete
    }
    q2: Persons {
        id initials name
    }
}
```

For more details, see the [all-in-one sample](./sample/), which even
provides a network interface through [HAPI](http://hapijs.com/) and the
[GraphiQL](https://github.com/graphql/graphiql) web interface on top of it
(with the help of its HAPI integration [HAPI-Plugin-GraphiQL](https://github.com/rse/hapi-plugin-graphiql)).

Application Programming Interface (API)
---------------------------------------

- `import GraphQLToolsSequelize from "graphql-tools-sequelize"`<br/>
  `gts = new GraphQLToolsSequelize(sequelize: Sequelize, options?: Object)`<br/>

  Creates a new GraphQL-Tools-Sequelize instance with an existing Sequelize instance `sequelize`.
  The `options` have to given, but can be an empty object. It can contain the following
  fields:

    - `validator(type: String, obj: Object, ctx: Object): Promise<Boolean>`:<br/>
      Optionally validate entity object `obj` (of entity type `type`)
      just before create or update operations. If the resulting
      Promise is rejected, the create or update operation fails.
      The `ctx` object is just passed through from the `GraphQL.graphql()` call.

    - `authorizer(moment: String, op: String, type: String, obj: Object, ctx: Object): Promise<Boolean>`:<br/>
      Optionally authorize entity object `obj` (of entity type `type`)
      for operation `op` (`create`, `read`, `update` or `delete`) at `moment` (`before` or `after`).
	  Notice that for `read` there is no `before` and for `delete` there is no `after`, of course. The `ctx` object is just passed through from
      the `GraphQL.graphql()` call. If the resulting Promise is rejected
      or returns `false`, the operation fails.

    - `tracer(record: Object, ctx: Object): Promise<any>`:<br/>
      Optionally trace the operation via the action `record`. The fields of `record` are:
      `{ op: String, arity: String, dstType: String, dstIds: String[], dstAttrs: String[] }`.
      The `ctx` object is just passed through from the `GraphQL.graphql()` call.

    - `fts: { [String]: String[] }`:<br/>
      Enables the Full-Text-Search (FTS) mechanism for all configured entity types
      and their listed attributes.

    - `idname: String = "id"`:<br/>
      Configures the GraphQL name of the mandatory unique identifier attribute on each entity.
      The default name is `id`.

    - `idtype: String = "UUID"`:<br/>
      Configures the GraphQL type of the mandatory unique identifier attribute on each entity.
      The default type `UUID` assumes that you define the GraphQL scalar type `UUID` with the help of
      [GraphQL-Tools-Types](https://github.com/rse/graphql-tools-types).

    - `idmake: Function = () => (new UUID(1)).format()`:<br/>
      Configures a function for generating unique identifiers for the mandatory unique identifier attribute on each entity.
      The default uses [pure-uuid](https://github.com/rse/pure-uuid) to generate UUIDs of version 1.

    - `hcname: String = "hc"`:<br/>
      Configures the GraphQL name of the optional hash-code attribute on each entity.
      The default name is `hc`. This attribute is NOT persisted and instead calculated on
      the fly and is intended to be used for optimistic locking purposes.

    - `hctype: String = "UUID"`:<br/>
      Configures the GraphQL type of the optional hash-code attribute on each entity.
      The default type `UUID` assumes that you define the GraphQL scalar type `UUID` with the help of
      [GraphQL-Tools-Types](https://github.com/rse/graphql-tools-types).

    - `hcmake: Function = (data) => (new UUID(5, "ns:URL", \`uri:gts:${data}\`)).format()`:<br/>
      Configures a function for generating hash-codes for the optional hash-code attribute on each entity.
      The default uses [pure-uuid](https://github.com/rse/pure-uuid) to generate UUIDs of version 5.

- `gts.boot(): Promise`:<br/>

  Bootstrap the GraphQL-Tools-Sequelize instance. It internally
  mainly initialized the Full-Text-Search (FTS) mechanism.

- `gts.attrIdSchema(source: String): String`,<br/>
  `gts.attrIdResolver(source: String): Function`:<br/>

  Generate a GraphQL schema entry and a corresponding GraphQL resolver
  function for querying the mandatory unique identifier attribute
  of an entity of type `source`. By default this generates a schema
  entry `<idname>: <idtype>` and a resolver which just returns
  `<object>[<idname>]`. This mandatory unique identifier attribute has
  to be persisted and hence part of the Sequelize schema definition.

- `gts.attrHcSchema(source: String): String`,<br/>
  `gts.attrHcResolver(source: String): Function`:<br/>

  Generate a GraphQL schema entry and a corresponding GraphQL resolver
  function for querying the optional hash-code attribute of an
  entity of type `source`. By default this generates a schema entry
  `<hcname>: <hctype>` and a resolver which returns something like
  `<hcmake>(data(<object>))`, where `data()` is an internal function
  which deterministically concatenates the values of all attributes of
  `<object>`. This optional hash-code attribute has NOT to be persisted
  and hence SHOULD NOT BE part of the Sequelize schema definition.

- `gts.entityQuerySchema(source: String, relation: String, target: String): String`,<br/>
  `gts.entityQueryResolver(source: String, relation: String, target: String): Function`:<br/>

  Generate a GraphQL schema entry and a corresponding GraphQL resolver
  function for querying one, many or all entities of particular entity
  type `target` when coming from entity type `source` -- either
  directly (in case `relation` is the empty string) or via relationship
  `relation`. The `target` is either just the name `foo` of an entity
  type `foo` (for relationship of cardinality 0..1) or `foo*` (for
  relationship of cardinality 0..N). Based on the combination of
  `relation` and the cardinality of `target`, four distinct GraphQL schema
  entries (and corresponding GraphQL resolver functions) are generated:

    - empty `relation` and `target` cardinality 0..1:<br/>

        ```js
        `# Query one [${target}]() entity by its unique identifier (\`id\`) or condition (\`where\`) or` +
        `# open an anonymous context for the [${target}]() entity.\n` +
        `# The [${target}]() entity can be optionally filtered by a condition on some relationships (\`include\`).\n` +
        `${target}(id: ${idtype}, where: JSON, include: JSON): ${target}\n`
        ```

    - empty `relation` and `target` cardinality 0..N:<br/>

        ```js
        `# Query one or many [${target}]() entities,\n` +
        "# by either an (optionally available) full-text-search (`query`)\n" +
        "# or an (always available) attribute-based condition (`where`),\n" +
        "# optionally filter them by a condition on some relationships (`include`),\n" +
        "# optionally sort them (`order`),\n" +
        "# optionally start the result set at the n-th entity (zero-based `offset`), and\n" +
        "# optionally reduce the result set to a maximum number of entities (`limit`).\n" +
        `${target}s(fts: String, where: JSON, include: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
        ```

    - non-empty `relation` and `target` cardinality 0..1:<br/>

        ```js
        `# Query one [${target}]() entity by following the **${relation}** relation of [${source}]() entity.\n` +
        `# The [${target}]() entity can be optionally filtered by a condition (\`where\`).\n` +
        `# The [${target}]() entity can be optionally filtered by a condition on some relationships (\`include\`).\n` +
        `${relation}(where: JSON, include: JSON): ${target}\n`
        ```

    - non-empty `relation` and `target` cardinality 0..N:<br/>

        ```js
        `# Query one or many [${target}]() entities\n` +
        `# by following the **${relation}** relation of [${source}]() entity,\n` +
        "# optionally filter them by a condition (`where`),\n" +
        "# optionally filter them by a condition on some relationships (`include`),\n" +
        "# optionally sort them (`order`),\n" +
        "# optionally start the result set at the n-th entity (zero-based `offset`), and\n" +
        "# optionally reduce the result set to a maximum number of entities (`limit`).\n" +
        `${relation}(where: JSON, include: JSON, order: JSON, offset: Int = 0, limit: Int = 100): [${target}]!\n`
       ```

  The comments are intentionally also generated, as they document
  the entries in the GraphQL schema and are visible through
  GraphQL schema introspection tools like GraphiQL.

- `gts.entity{Create,Clone,Update,Delete}Schema(type: String): String`,<br/>
  `gts.entity{Create,Clone,Update,Delete}Resolver(type: String): Function`:<br/>

  Generate a GraphQL schema entry and a corresponding GraphQL resolver
  function for mutating one, many or all entities of particular entity
  type `type`. The following GraphQL schema
  entries (and corresponding GraphQL resolver functions) are generated:

    - For `entityCreate{Schema,Resolver}(type)`:<br/>

        ```js
        `# Create new [${type}]() entity, optionally with specified attributes (\`with\`).\n` +
        `create(id: ${idtype}, with: JSON): ${type}!\n`
        ```

    - For `entityClone{Schema,Resolver}(type)`:<br/>

        ```js
        `# Clone one [${type}]() entity by cloning its attributes (but not its relationships).\n` +
        `clone: ${type}!\n`
        ```

    - For `entityUpdate{Schema,Resolver}(type)`:<br/>

        ```js
        `# Update one [${type}]() entity with specified attributes (\`with\`).\n` +
        `update(with: JSON!): ${type}!\n`
        ```

    - For `entityDelete{Schema,Resolver}(type)`:<br/>

        ```js
        `# Delete one [${type}]() entity.\n` +
        `delete: ${idtype}!\n`
        ```

  The comments are intentionally also generated, as they document
  the entries in the GraphQL schema and are visible through
  GraphQL schema introspection tools like GraphiQL.

Assumptions
-----------

It is assumed that all your Sequelize entities have an attribute
`id` (see also `idname` configuration option) which is the
(technical) primary key of an entity. By default, the type of
field `id` is `UUID`, but this can be overridden (see `idtype`
configuration option). In case of the type `UUID`, it is assumed
that you define the GraphQL scalar type `UUID` with the help of
[GraphQL-Tools-Types](https://github.com/rse/graphql-tools-types).

Notice: all entities are required to have the field `id` and the type
of all `id` fields have to be the same. But this does not prevent you
from having *additional* domain-specific primary keys per entity of an
arbitrary type, of course. GraphQL-Tools-Sequelize just uses the field
`id` for its functionality.

In addition, the scalar type `JSON` always has to be defined with the help of
[GraphQL-Tools-Types](https://github.com/rse/graphql-tools-types).

License
-------

Copyright (c) 2016-2019 Dr. Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

