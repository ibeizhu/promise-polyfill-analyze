// Store setTimeout reference so promise-polyfill will be unaffected by
// other code modifying setTimeout (like sinon.useFakeTimers())
var setTimeoutFunc = setTimeout;

// 空方法，用作 then()内部 Promise 的形参
function noop() {}

// Polyfill for Function.prototype.bind
function bind(fn, thisArg) {
  return function() {
    fn.apply(thisArg, arguments);
  };
}

function Promise(fn) {
  if (!(this instanceof Promise))
    throw new TypeError('Promises must be constructed via new');
  if (typeof fn !== 'function') throw new TypeError('not a function');
  /**
   * _state: 0 padding  _value:{undefined}
   * _state: 1 onResolved  _value:{正常值}
   * _state: 2 onRejected  _value:{值 || 异常对象}
   * _state: 3 onResolved  _value:{Promise}
   * @type {number}
   * @private
   */
  this._state = 0;
  // 是否被正常处理，false 情况则打印错误
  this._handled = false;
  // 存放 Promise 值,resolve 正常值，reject 可能是异常对象
  this._value = undefined;
  // 存放 Handle 实例对象的数组
  this._deferreds = [];

  doResolve(fn, this);
}

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
function doResolve(fn, self) {
  // done变量保护 resolve 和 reject 只执行一次
  // 这个done在 Promise.race()函数中有用
  var done = false;
  try {
    // 立即执行 Promise 传入的 fn(resolve,reject)
    fn(
      function(value) {
        // resolve 回调
        if (done) return;
        done = true;
        resolve(self, value);
      },
      function(reason) {
        // reject 回调
        if (done) return;
        done = true;
        reject(self, reason);
      }
    );
  } catch (ex) {
    if (done) return;
    done = true;
    reject(self, ex);
  }
}

function resolve(self, newValue) {
  try {
    // resolve 的值不能为本身 this 对象
    // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
    if (newValue === self)
      throw new TypeError('A promise cannot be resolved with itself.');
    // 针对 resolve 值为 Promise 对象的情况处理
    if (
      newValue &&
      (typeof newValue === 'object' || typeof newValue === 'function')
    ) {
      var then = newValue.then;
      if (newValue instanceof Promise) {
        self._state = 3;
        self._value = newValue;
        finale(self);
        return;
      } else if (typeof then === 'function') {
        // 兼容类 Promise 对象的处理方式，对其 then 方法继续执行 doResolve
        console.log('typeof self',self instanceof Promise);
        console.log('typeof newValue',newValue instanceof global.Promise);
        doResolve(bind(then, newValue), self);
        return;
      }
    }
    //  resolve 正常值的流程，_state = 1
    self._state = 1;
    self._value = newValue;
    finale(self);
  } catch (e) {
    reject(self, e);
  }
}

function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  finale(self);
}

/**
 * resolve reject 会调用此方法，来执行 then 方法的 onFulfilled, onRejected回调
 * onFulfilled, onRejected回调封装在_deferreds数组里面，每个都是 Handle 实例
 * @param self
 */
function finale(self) {
  //  Promise reject 情况，但是 then 方法未提供 reject 回调函数参数 或者 未实现 catch 函数
  if (self._state === 2 && self._deferreds.length === 0) {
    Promise._immediateFn(function() {
      if (!self._handled) {
        Promise._unhandledRejectionFn(self._value);
      }
    });
  }

  console.log('self._deferreds.length', self._deferreds.length);
  for (var i = 0, len = self._deferreds.length; i < len; i++) {
    // 这里调用之前 then 方法传入的onFulfilled, onRejected函数
    // self._deferreds[i] => Handler 实例对象
    handle(self, self._deferreds[i]);
  }
  self._deferreds = null;
}

function Handler(onFulfilled, onRejected, promise) {
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}

Promise.prototype.then = function(onFulfilled, onRejected) {
  console.log('Promise.then');
  var prom = new this.constructor(noop);
  // Handler对象作为一个 deferred
  handle(this, new Handler(onFulfilled, onRejected, prom));
  // 每个 then 方法返回一个新的 Promise对象，支持链式的 promise.then().then().then()
  return prom;
};

/**
 *
 * @param self 当前 Promise 对象
 * @param deferred Handle 对象
 */
function handle(self, deferred) {
  // 如果当前的self._value instanceof Promise
  // 将self._value => self，接下来处理新 Promise
  while (self._state === 3) {
    self = self._value;
  }
  // self._state=== 0 说明还没有执行 resolve || reject 方法
  // 此处将 handle 挂起
  if (self._state === 0) {
    console.log('self._state === 0')
    console.log('handle::self._deferreds.push');
    self._deferreds.push(deferred);
    return;
  }
  self._handled = true;
  // 通过事件循环异步来做回调的处理
  Promise._immediateFn(function() {
    // deferred.promise ：第一个 Promise then 方法 返回的新 Promise 对象
    // 这里调用下一个 Promise 对象的 then 方法的回调函数
    // 如果当前 Promise resolve 了，则调用下一个 Promise 的 resolve方法，反之，则调用下一个 Promise 的 reject 回调
    // 如果当前 Promise resolve 了，则调用下一个 Promise 的 resolve方法
    // cb回调方法：如果自己有onFulfilled||onRejected方法，则执行自己的方法；如果没有，则调用下一个 Promise 对象的onFulfilled||onRejected
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
    // 自己没有回调函数，进入下一个 Promise 对象的回调
    if (cb === null) {
      (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
      return;
    }
    // 自己有回调函数，进入自己的回调函数
    var ret;
    try {
      ret = cb(self._value);
    } catch (e) {
      reject(deferred.promise, e);
      return;
    }
    // 处理下一个 Promise 的 then 回调方法
    // ret 作为上一个Promise then 回调 return的值 => 返回给下一个Promise then 作为输入值
    resolve(deferred.promise, ret);
  });
}

/**
 * catch 是 js 的保留字，这里用字符串
 * @param onRejected
 * @return {Promise.<TResult>}
 */
Promise.prototype['catch'] = function(onRejected) {
  return this.then(null, onRejected);
};

/**
 * finally 是 js 的保留字，这里用字符串
 * @param callback
 * @return {Promise.<TResult>}
 */
Promise.prototype['finally'] = function(callback) {
  var constructor = this.constructor;
  return this.then(
    function(value) {
      return constructor.resolve(callback()).then(function() {
        return value;
      });
    },
    function(reason) {
      return constructor.resolve(callback()).then(function() {
        return constructor.reject(reason);
      });
    }
  );
};

/**
 * 用法：Promise.all[promise1,promise2,promise3].then(([val1,val2])=>{})
 * @param arr promise 数组
 * @return {Promise}
 */
Promise.all = function(arr) {
  return new Promise(function(resolve, reject) {
    if (!arr || typeof arr.length === 'undefined')
      throw new TypeError('Promise.all accepts an array');
    var args = Array.prototype.slice.call(arr);
    if (args.length === 0) return resolve([]);
    var remaining = args.length;

    function res(i, val) {
      try {
        // 如果 val 是 Promise 对象的话，则执行 Promise,直到 resolve 了一个非 Promise 对象
        if (val && (typeof val === 'object' || typeof val === 'function')) {
          var then = val.then;
          if (typeof then === 'function') {
            then.call(
              val,
              function(val) {
                res(i, val);
              },
              reject
            );
            return;
          }
        }
        // 用当前resolve||reject 的值重写 args[i]{Promise} 对象
        args[i] = val;
        // 直到所有的 Promise 都执行完毕，则 resolve all 的 Promise 对象，返回args数组结果
        if (--remaining === 0) {
          resolve(args);
        }
      } catch (ex) {
        // 只要其中一个 Promise 出现异常，则全部的 Promise 执行退出，进入 catch异常处理
        // 因为 resolve 和 reject 回调有 done 变量的保证只能执行一次，所以其他的 Promise 都不执行
        reject(ex);
      }
    }

    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

Promise.resolve = function(value) {
  // 如果 value 本身是 Promise 对象，则直接返回 value
  if (value && typeof value === 'object' && value.constructor === Promise) {
    return value;
  }

  return new Promise(function(resolve) {
    resolve(value);
  });
};

Promise.reject = function(value) {
  return new Promise(function(resolve, reject) {
    reject(value);
  });
};

/**
 * 用法：Promise.race[promise1,promise2,promise3].then(val=>{})
 * @param values promise数组
 * @return {Promise}
 */
Promise.race = function(values) {
  return new Promise(function(resolve, reject) {
    for (var i = 0, len = values.length; i < len; i++) {
      // 因为doResolve方法内部 done 变量控制了对 resolve reject 方法只执行一次的处理
      // 所以这里实现很简单，清晰明了，最快的 Promise 执行了  resolve||reject，后面相对慢的 Promise都不执行
      values[i].then(resolve, reject);
    }
  });
};

// Use polyfill for setImmediate for performance gains
Promise._immediateFn =
  (typeof setImmediate === 'function' &&
    function(fn) {
      setImmediate(fn);
    }) ||
  function(fn) {
    setTimeoutFunc(fn, 0);
  };

/**
 * 未捕捉到错误的处理（即 reject 执行了，但是没有 catch 到异常）
 * @param err
 * @private
 */
Promise._unhandledRejectionFn = function _unhandledRejectionFn(err) {
  if (typeof console !== 'undefined' && console) {
    console.warn('Possible Unhandled Promise Rejection:', err); // eslint-disable-line no-console
  }
};

module.exports = Promise;
