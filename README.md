Qwx
===========

**Qwx** minimalist bootloader for node

* With only 2 methods you can up your app
* Concise, ~350 lines of code
* No externals dependencies
* Cluster support
* Asynchronous app loading
* Memory optimized
* Bye bye `require` with `../../../`

**Qwx** provide an application mount pipeline, it virtualy mount your files structure as a lazy object.
For example, a file structure like 
    
    /src/
        /models
            A.js
            B.js
            /extras
                /C.js

Can be accessed in node as
```javascript
new models.A()
new models.extras.C()
```
**Don't worry for your memory!** If *B.js* is never called by application, it will never be loaded!

**Qwx** allow to manage your pipeline asynchronously, so you can wait load config or database connection before you start your app

**Qwx** permit to use cluster mode natively, and you can scale down or scale up your app on demand!

[![npm status](https://nodei.co/npm/qwx.svg?downloads=true&stars=true&downloadRank=true)](https://npmjs.org/package/qwx)


Installation
========

    npm install qwx


Ok, how to use
============

```javascript
require('qwx')('myApp')
    .option('appDir', 'src' )

    .mount('lib')
    .mount('models')
    .mount('controllers')
    .mount('services')

    .mount('custom.path', function( ) {
        return 'Hello';
    })
    .run( function( $ ) {
        $();
    })
    .run('services')

;

```


Construct
===========
`require('qwx')` return factory to Qwx with signature `Qwx( name[, options ] )`

To create new app instance:
```javascript
require('qwx')('myApp');
```

After this, you can retrieve instance of your app on global variable `myApp` 
`myApp` becomes the root mount point of your application

Methods
========

All methods execpt getter `option` and `options` are chained and return app instance.


## mount( directory )
Mount directory structure, alias of `mount( directory, directory )`

## mount( mountPoint, directory )
Mount `directory` on `mountPoint`

    /src/
        /models
            /api
                A.js
                B.js


```javascript
.mount('models.api','src/models/api')
```

You can retrieve your models like this,
```javascript
models.api.A // model A
models.api.B // model B
```

_Note: See `appDir` to simplify things_

## mount( mountPoint, handler )
Mount `handler` on `mountPoint`

## run( handler)
Push to the loading pipeline and run `handler`.
If `handler` signature is like `handler( cb )`, pipeline will wait after callback return.

```javascript
.run(function( cb ) { // Excute function as async function
    setTimeout( function( ) {
        cb();
    },1000)
})
.run(function() { //Execute function as sync function

})
```

## run( mountPoint )
Like `run` execute file at mount point. If mount moint is directory, run will execute all mount point at first level under this directory.

For file structure like
```
    /app
        /services
            /a.js
            /b.js
```
```javascript
.run('services/a') // Execute only a
.run('services') // Execute a and b
```

_Note: If mount point isn't mounted, `run` will call `mount` before_

## option( name[, value] )
Get or set option

```javascript
.option('myOption', 'myValue')
////
.option('myOption') // Get myOption
```

### appDir
By default to `.`, is the dir where file are located.
For example if your project is structured like this
```
    /src
        /models
            ..
        /services
            ..
    index.js
```

Instead of use 
```javascript
.mount('models','src/models');
.mount('services','src/services');
```
you can..
```javascript
.option('appDir', 'src');
.mount('models');
.mount('services');
```

### appRoot
Define custom root mount point. By default app name is used as appRoot

### mask
Mask to match file or directory
By default is set to `/^[^._]/`, ignore file staring with "." or "_"
_Note: mask must be a regex object_

### maxDepth
Depth limitation to mount directories, 15 by default

### debug
Enable qwx traces
This option is special, and if you want debug from beginnig, you must be set op app construction.

```javascript
require('qwx')('myApp', { debug: true });
```


### forkRespawn
Force respawn forks on errors
A derived use from it, is to autoreload app on error.

```javascript
.option('forkRespawn', true)
.scale(1) // Sacle to single fork
.forkRun('services') // Execute all services without service interruption!
```

## options( [ options ] )
Get or set options map
```javascript
.options({
    forkRespawn: true,
    maxDepth: 3
});
///
.options() // Get all options
```

## scale( size )
Scale app to size.
You can set `"full"` to use all machine processors

```javascript
.scale(0) // Disable clustering mode, only 1 process
.scale(1) // create 1 fork, so 2 process 1 master and 1 fork
.scale(2) // Scale to 2 forks
.scale(1) // Scale down
.scale('full') //Scale to 4 on the quad core processor
```

Clustering
==========
You can isolate action between master and fork ( also called worker ) by prefixing your method by `master` or `fork`

Example:

```javascript
.scale( 2 ) // create 2 forks
.forkOption('appDir', 'worker') // Set specific fork appdir
.masterMount( 'myMasterMount' ) // Only mount for master thread
.run(function(){
    // Running action for master and forks
})
.forkRun( function() {
    // Running only on fork
})
```

_Note: Only master process can scale app._


Project sample
===============


For project structure like
```
    /src
        /config
            production.js
        /lib
            mysql.js // Provide connection initialisation
        /models
            .. Various models
        /controllers
            .. Various controllers
        /services
            /server.js
            /sync.js
    index.js
```

For example in server you can use an `express` server


And in index.js :

```javascript
require('qwx')('app') // Mount Qwx instance on global.app
    .option('appDir', 'src' ) // Files are in src
    .mount('config', require('config') ) // Mount package "config"
    .mount('lib') // Mount lib directory
    .mount('models') // Mount models
    .mount('controllers') // Mount controllers
    .run( function doConnection( $doConnectionDone ) {
        app.lib.mysql.initConnection( function( err ) {
            if( err ) {
                console.error( 'Unable to connect to database', err );
                process.exit();
            }
            // Connection ok, next!
            $doConnectionDone();
        } );
    })
    .run( function( ) {
        console.log('Pipeline complete, running services!');
    })
    .run('services') 
    // Start server service and some sync service
;
```




