'use strict';

var fs = require('fs');
var path = require('path');
var cluster = require('cluster');

var defaultOptions = {
  appDir: '.',
  appRoot: null,
  mask: /^[^._]/, // Ignore file start with "." or "_",
  maxDepth: 15,
  debug: false,
  forkRespawn: false,
  scope: global
};

global.__qwx_instances = global.__qwx_instances || {};
var intances = global.__qwx_instances;

function callAsyncHandler( target, handler, $delayedHandler ) {
  if( handler.length === 1 ) {
    handler.call( target, $delayedHandler );
  }
  else if( handler.length === 2 ) {
    handler.call( target, target, $delayedHandler );
  }
  else {
    handler.call( target );
    $delayedHandler(); 
  }
}

function log( obj ) {
  if( obj._opts.debug ) {
    console.log.apply( console, ['['+ obj.name + ':' + ( cluster.isMaster ? 'master' : cluster.worker.id ) +']'].concat( Array.prototype.slice.call( arguments, 1 )) );
  }
}

function setReadonly( obj, name, value ) {
  Object.defineProperty( obj, name, {
    value: value,
    writable: false,
    enumerable: true,
    configurable: false
  });
}

function scope( scope, name, value ) {
  if( arguments.length === 3 ) {
    name ? (scope[name] = value) : (scope = value);
  }
  else {
    return name ? scope[name] : scope;
  }
}

function fileExistsSync( fn ) {
  try {
    fs.accessSync( fn );
  }
  catch( e ) {
    return false;
  }
  return true;
}

function Pipeline( appName ) {
  this._appName = appName;
  this._stack = [];
  this._current = null;
}
Pipeline.prototype = {
  push: function( handler ) {
    this._stack.push( handler );
    this.consume();
  },
  consume: function() {
    if( this._current ) {
      return;
    }
    var stage = this._stack.shift();
    if( !stage ) {
      return;
    }
    this._current = stage;
    callAsyncHandler( intances[this._appName], stage, function() {
      this._current = null; //release current
      process.nextTick( function() {
        this.consume();
      }.bind( this ));
    }.bind( this ));
  }
};

var methods = {
  options: function( obj ) {
    var k;
    if( !arguments.length ) {
      return this._opts;
    }
    for( k in obj ) {
      this.option( k, obj[k] ); 
    }
    return this;
  },

  option: function( name, value ) {
    if( arguments.length === 1 ) {
      return this._opts[name];
    }
    this._pipeline.push( function setOption() {
      log( this, 'Set option', name, '=', JSON.stringify(value) );
      this._opts[name] = value;
    });
    return this;
  },
  context: function( name, opts, inherit ) {
    opts = opts || {};
    if( inherit || arguments.length < 3 ) { // inherit by default
      for( var k in this._opts ) {
        opts[k] = k in opts ? opts[k] : this._opts[k];
      }
    }
    log(this, 'Create context', name );
    opts.appName = opts.appName || this.name; // Force app name
    var app = new Qwx( name, opts );
    setReadonly( app, '_parent', this );
    return app;
  },
  mount: function( ) {
    var a = arguments;
    if( a.length === 1 
      && typeof a[0] === 'string' ) {
      return this.mountDir.apply( this, a );
    }
    else if( a.length === 2 
      && typeof a[0] === 'string' 
      && typeof a[1] === 'string' ) {
      return this.mountDir.apply( this, a );
    }
    else if( a.length === 2 
      && typeof a[0] === 'string' ) {
      return this.mountObject.apply( this, a );
    }
    throw new Error('Unknow mount function signature');
  },

  mountDir: function( mountPoint, dir, limit ) {
    var a = arguments;
    if( a.length === 1 ) {
      dir = a[0];
    }
    limit = a.length === 3 ? a[2] : this.option('maxDepth');
    this._pipeline.push( function mountDir() {
      log( this, 'Mount dir', dir, 'on', mountPoint );
      var appDir = this.option('appDir') || '';
      var self = this;
      var mask = self.option('mask') instanceof RegExp ? self.option('mask') : null;
      appDir = path.normalize(appDir.replace(/(^[^\/]+)/, process.cwd() + '/$1' ));
      dir = path.join( appDir, dir );
      mountPoint = mountPoint.replace(/[\/\\]+/,'.');
      if( !fileExistsSync( dir ) ) {
        if( fileExistsSync( dir + '.js' ) ) { // Try with .js extension
          dir += '.js'; // OK .js was ommited
        }
        else {
          log( this, 'Unable to mount', dir,': not found');
          return this; // Ignore
        }
      }
      function mount( mountPoint, pth, limit ) {
        var fStat = fs.lstatSync( pth );
        if( fStat.isDirectory() ) {
          if( limit > 0 ) {
            (fs.readdirSync( pth ) || []).forEach( function( fn ) {
              if( mask && mask.test( fn ) ) {
                mount( mountPoint + '.' + fn, path.normalize( path.join( pth, fn ) ), limit-1 );
              }
            });
          }
        }
        else if( /\.js(on)?$/.test( pth  ) ) {
          pth = pth.charAt(0) === '/' ? pth : './' + pth ;
          log( self, 'file', pth);
          self._mountObject( mountPoint.replace(/\.js(on)?$/,''), function() {
            return require( pth );
          }, 'lazyFunction' );
        }
      }
      mount( mountPoint, dir, limit );
    });
    return this;
  },

  mountObject: function( mountPoint, obj, mode ) {
    this._pipeline.push( function mountObject() {
      this._mountObject( mountPoint, obj, mode );
    });
    return this;
  },

  _mountObject: function( mountPoint, obj, mode ) {
    log( this, 'Mount object on', mountPoint );
    var mp = this._getMountPoint( mountPoint, true );
    var def = { enumerable: true, configurable: true };
    if( mode === 'lazyFunction' ) {
      def.get = obj;
    }
    else if ( mode === 'value' ) {
      def.value = obj;
      def.writable = false;
    }
    else {
      def.get = function() {
        return obj;
      };
    }
    Object.defineProperty( mp.target, mp.name, def );
    return this;
  },

  scale: function( value ) {
    if( arguments.length === 1 ) {
      if( value === 'full' ) {
        value = require('os').cpus().length;
      }
      this.option('numForks', +value );
      this._pipeline.push( function() { this.scale(); });
      return this;
    }
    if( !cluster.isMaster || this._clusterScalingOffset !== 0 ) {
      return;
    }
    var forks = this.option('numForks') || 0;
    var self = this;
    log( this, 'scaling to', forks );
    if( forks > 0 ) {
      var workers = Object.keys( cluster.workers );
      if( workers.length > forks ) { // Scale down
        log( this, 'scaling down' );
        this._clusterScalingOffset = workers.length - forks;
        workers.slice( forks ).forEach( function( k ) {
          cluster.workers[k]
            .on('disconnect', function( ) {
              self._clusterScalingOffset--; 
            });
          cluster.workers[k].kill();
        });
      }
      else if( workers.length < forks ) { // Scale up
        log( this, 'scaling up');
        this._clusterScalingOffset = workers.length - forks;
        var i, fork;
        for( i = workers.length ; i < forks; i++ ) {
          fork = cluster.fork();
          fork
            .on('exit', function() {
              if( self.option('forkRespawn') ) {
                process.nextTick( function(){
                  self.scale();
                });
              }
            })
            .on('online', function() {
              self._clusterScalingOffset++;
            });
        }
      }
    }
  },

  run: function( name ) {
    if( typeof name === 'function' ) {
      this._pipeline.push( name );
      return this;
    }
    if( !this._resolve( name ) ) {
      this.mount( name );
    }
    this._pipeline.push( function() {
      var o = this._resolve( name );
      if( typeof o === 'function' ) {
        log( this, 'Running', name );
        o();
      }
      else {
        Object.keys( o || {} ).forEach( function( k ) {
          log( this, 'Running', name ,'/' , k );
          var tmp = o[k]; // Force get
        }.bind( this ));
      }
    });
    return this;
  },

  _resolve: function( mountPoint ) {
    var toks = mountPoint.split(/[.\/\\]+/);
    var o = scope( this._scope, this._opts.appRoot );
    var tok;
    while( tok = toks.shift() ) {
      if( !o[tok] ) {
        return null;
      }
      o = o[tok];
    }
    return o;
  },

  _getMountPoint: function( mountPoint, asObject ) {
    var toks = mountPoint.split(/[.\/\\]+/);
    var name;
    var o = scope( this._scope, this._opts.appRoot );
    var tok;
    if( asObject ) {
      name = toks.pop();
    }
    while( tok = toks.shift() ) {
      if( !o[tok] ) {
        o[tok] = {};
      }
      o = o[tok];
    }
    if( asObject ) {
      return { target:o, name:name };
    }
    return o;
  },
};

//Project methods for clustering
[['master','isMaster'],['fork','isWorker']]
  .forEach( function( m ) {
    methods[ m[0] ] = function( forkHandler ) {
      if( cluster[ m[1] ] ) {
        forkHandler( this );
      }
    };
    ['option','options','mount','mountObject','mountDir','run']
      .forEach(function( name ) {
        var nameCap = name[0].toUpperCase() + name.slice(1);
        methods[ m[0] + nameCap ] = function() {
          if( cluster[ m[1] ] ) {
            return methods[ name ].apply( this, arguments );  
          }
          return this;
        };
      });
  });

function Qwx( name, options ) {
  var k;
  this._opts = {};
  for( k in defaultOptions ) { this._opts[k] = defaultOptions[k] };
  if( options ) {
    for( k in options ) { this._opts[ k ] = options[ k ]; }
  }
  this._opts.appRoot = this._opts.appRoot || name;
  this._pipeline = new Pipeline( name );
  this._clusterScalingOffset = 0;
  this._scope = this._opts.scope instanceof Qwx ? this._opts.scope._scope : this._opts.scope;
  setReadonly( this, 'name', name );
  setReadonly( this, 'forkId', cluster.worker ? cluster.worker.id : 0 );
  for(  k in methods ) {
    setReadonly( this, k, methods[k] );
  }
  log( this, 'Init new qwx app' );
  intances[ name ] = intances[ name ] || this;
  if( !scope( this._scope, this._opts.appRoot ) ) {
    log( this, 'Mount on', this._opts.appRoot );
    scope( this._scope, this._opts.appRoot, this ); // Register and mount on appRoot!
  }
}

module.exports = function( name, options ) {
  if( options && options.scope && options.scope instanceof Qwx ) {
    return options.scope.context( name, options, true );
  }
  var appRoot = ( options ? options.appRoot : '' ) || name;
  var appScope = ( options ? options.scope : global ) || global;
  if( scope( appScope, appRoot ) ) {
    if( scope( appScope, appRoot ) instanceof Qwx ) {
      return scope( appScope, appRoot );
    }
    throw 'Unable to mount app to "'+appRoot+'"';
  }
  return new Qwx( name, options );
};