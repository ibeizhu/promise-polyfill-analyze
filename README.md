## 开篇

最近在 github 上看到了一个 extremely lightweight Promise polyfill 实现，打开源码发现只有240行，果然极其轻量级，于是带着惊叹和好奇的心理去了解了下其具体实现。
源码的 github 地址：[promise-polyfill](https://github.com/taylorhakes/promise-polyfill)

Promise 对于前端来说，是个老生常谈的话题，Promise 的出现解决了 js 回调地域的问题。目前市面上有很多 Promise 库，但其最终实现都要遵从 Promise/A+ 规范,这里对规范不做解读，有兴趣的可以查看链接内容。
[Promise/A+规范链接](https://promisesaplus.com/)
[Promise/A+规范中文链接](https://segmentfault.com/a/1190000002452115)

本篇文章将从 Promise 的使用角度来剖析源码具体实现。

## API 列表
```
Promise  // 构造函数
Promise.prototype.then
Promise.prototype.catch
Promise.prototype.finally

// 静态方法
Promise.resolve
Promise.reject
Promise.race
Promise.all
```

## 源码解析

### 构造函数
使用
Promise 使用第一步，构造实例，传入 Function 形参，形参接收两个 Function 类型参数resolve, reject
```
const asyncTask = () => {};
const pro = new Promise((resolve, reject) => {
  asyncTask((err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
});
```
源码
```
function Promise(fn) {
  if (!(this instanceof Promise))
    throw new TypeError('Promises must be constructed via new');
  if (typeof fn !== 'function') throw new TypeError('not a function');
  this._state = 0;
  this._handled = false;
  this._value = undefined;
  this._deferreds = [];
  doResolve(fn, this);
}

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
```
Promise必须通过构造函数实例化来使用，传入 Promise 构造函数的形参 fn 在doResolve方法内是 **立即调用执行** 的，并没有异步(指放入事件循环队列)处理。doResolve内部针对 fn 函数的回调参数做了封装处理，done变量保证了 resolve reject 方法只执行一次，这在后面说到的Promise.race()函数实现有很大用处。

#### Promise 实例的内部变量介绍

|名称|类型|默认值|描述|
|:---------------|:--------|:----|:----------|
|_state|Number|0| Promise内部状态码|
|_handled|Boolean|false|onFulfilled,onRejected是否被处理过|
|_value|Any|undefined|Promise 内部值，resolve 或者 reject返回的值|
|_deferreds|Array|[]|存放 Handle 实例对象的数组，缓存 then 方法传入的回调|

_state枚举值类型
```
_state === 0  // pending
_state === 1  // fulfilled,执行了resolve函数，并且_value instanceof Promise === true
_state === 2  // rejected,执行了reject函数
_state === 3  // fulfilled,执行了resolve函数，并且_value instanceof Promise === false
```
**注意**：这里_state区分了1 和 3 两种状态，下面会解释原因

```
/**
 * Handle 构造函数
 * @param onFulfilled resolve 回调函数
 * @param onRejected reject 回调函数
 * @param promise 下一个 promise 实例对象
 * @constructor
 */
function Handler(onFulfilled, onRejected, promise) {
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}
```

_deferreds数组的意义：当在 Promise 内部调用了异步处理任务时，pro.then(onFulfilled,onRejected)传入的两个函数不会立即执行，所以此时会把当前的回调和下一个 pro 对象关联缓存起来，待到 resolve 或者 reject触发调用时，会去 forEach 这个_deferreds数组中的每个 Handle 实例去处理对应的 onFulfilled,onRejected 方法。

### Promise 内部 resolve reject finale 方法
上面说到，doResolve 内部做了 fn 的立即执行，并保证 resolve 和 reject 方法只执行一次，接下来说说resolve 和 reject 内部具体做了什么
```
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

function finale(self) {
  //  Promise reject 情况，但是 then 方法未提供 reject 回调函数参数 或者 未实现 catch 函数
  if (self._state === 2 && self._deferreds.length === 0) {
    Promise._immediateFn(function() {
      if (!self._handled) {
        Promise._unhandledRejectionFn(self._value);
      }
    });
  }

  for (var i = 0, len = self._deferreds.length; i < len; i++) {
    // 这里调用之前 then 方法传入的onFulfilled, onRejected函数
    // self._deferreds[i] => Handler 实例对象
    handle(self, self._deferreds[i]);
  }
  self._deferreds = null;
}
```
resolve,reject 是由用户在异步任务里面触发的回调函数
调用 resolve reject 方法的注意点
1、**newValue不能为当前的 this 对象**，即下面的这样写法是错误的
```
const pro = new Promise((resolve)=>{setTimeout(function () {
  resolve(pro);
},1000)});
pro.then(data => console.log(data)).catch(err => {console.log(err)});
```
因为resolve做了 try catch 的操作，直接会进入 reject 流程。

2、**newValue可以为另一个Promise 对象类型实例**， resolve 的值返回的是另一个 Promise 对象实例的内部的_value,而不是其本身 Promise 对象。即可以这样写
```
const pro1 = new Promise((resolve)=>{setTimeout(function () {
  resolve(100);
},2000)});
const pro = new Promise((resolve)=>{setTimeout(function () {
  resolve(pro1);
},1000)});
pro.then(data => console.log('resolve' + data)).catch(err => {console.log('reject' + err)});
// 输出结果：resolve 100
// data 并不是pro1对象
```
具体原因就在 resolve 方法体内部做了newValue instanceof Promise的判断，并将当前的_state=3,self._value = newValue,然后进入 finale 方法体，在 handle 方法做了核心处理，这个下面介绍 handle 方法会说到；

这里有一个注意点，resolve 的 value 可能是其他框架的 Promise(比如：global.Promise，nodejs 内部的 Promise 实现) 构造实例，所以在typeof then === 'function'条件下做了doResolve(bind(then, newValue), self);的重新调用，继续执行当前类型的 Promise then 方法，即又重新回到了doResolve流程。

如果这里的实现方式稍微调整下，即不管newValue是自身的 Promise 实例还是其他框架实现的 Promise实例，都执行doResolve(bind(then, newValue), self)也能行得通,只不过会多执行 then 方式一次，从代码性能上说，上面的实现方式会更好。参照代码如下
```
function resolve(self, newValue) {
  try {
    // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
    if (newValue === self)
      throw new TypeError('A promise cannot be resolved with itself.');
    if (
      newValue &&
      (typeof newValue === 'object' || typeof newValue === 'function')
    ) {
      // 这里简单粗暴处理，无论是 Promise 还是 global.Promise
      // 都直接调用doResolve
      var then = newValue.then;
      if (typeof then === 'function') {
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
```

所有 resolve 和 reject 的值最终都会去到finale函数中去处理,只不过在这里的_state状态会有所不同；当Promise 出现reject的情况时，而没有提供 onRejected 函数时，内部会打印一个错误出来，提示要捕获错误。代码实现即
```
const pro = new Promise((resolve,reject)=>{setTimeout(function () {
  reject(100);
},1000)});
pro.then(data => console.log(data));  // 会报错
pro.then(data => console.log(data)).catch();  // 会报错
pro.then(data => console.log(data)).catch(()=>{});  // 不会报错
pro.then(data => console.log(data),()=>{})  // 不会报错
```


### then、catch、finally 方法
第二步，调用 then 方法来处理回调,支持无限链式调用，then 方法第一个参数成功回调，第二个参数失败或者异常回调

源码
```
function noop() {}

Promise.prototype.then = function(onFulfilled, onRejected) {
  var prom = new this.constructor(noop);
  handle(this, new Handler(onFulfilled, onRejected, prom));
  return prom;
};

Promise.prototype['catch'] = function(onRejected) {
  return this.then(null, onRejected);
};

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
```

Promise.prototype.then方法内部构造了一个新的Promsie 实例并返回，这样从 api 角度解决了 Promise 链式调用的问题，而且值得注意的是，**每个 then 方法返回的都是一个新的 Promise 对象，并不是当前的 this链接调用方式**。最终的处理都会调用 handle 方法。

catch方法在 then 方法上做了一个简单的封装，所以从这里也可以看出，then 方法的形参并不是必传的，catch 只接收onRejected。

finally方法不管是调用了 then 还是 catch，最终都会执行到finally的 callback


### 核心逻辑：handle方法内部实现
上面说了这么多，最终的 resolve reject 回调处理都会进入到 handle 方法中，来处理onFulfilled 和 onRejected，先看源码
```
Promise._immediateFn =
  (typeof setImmediate === 'function' &&
    function(fn) {
      setImmediate(fn);
    }) ||
  function(fn) {
    setTimeoutFunc(fn, 0);
  };
  
function handle(self, deferred) {
  // 如果当前的self._value instanceof Promise
  // 将self._value => self，接下来处理新 Promise
  while (self._state === 3) {
    self = self._value;
  }
  // self._state=== 0 说明还没有执行 resolve || reject 方法
  // 此处将 handle 挂起
  if (self._state === 0) {
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
```

self._state === 3，说明当前 resolve(promise)方法回传的值类型为 Promise 对象,
即 self._value instanceOf Promise === true， **将 self=self._value,即当前处理变更到了新的 Promise 对象上** ，如果当前 promise对象内部状态是fulfilled或者 rejected，则直接处理onFulfilled 或者 onRejected回调；如果仍然是 padding 状态，则继续等待。这就很好的解释了为什么resolve(pro1),pro.then的回调取的值却是 pro1._value.
从使用角度来看
```
const pro1 = new Promise(resolve=>{setTimeout(()=>{resolve(100)},1000)})  // 执行耗时1s 的异步任务
pro.then(()=>pro1).then(data => console.log(data)).catch(err => {});
// 输出结果: 正常打印了100，data并不是当前的pro1对象
```
pro1内部是耗时1s 的异步任务，此时self._state === 0，即内部是 Padding 状态，则将deferred对象 push 到_deferreds数组里面,然后等待 pro1内部调用resolve(100)时，继续上面resolve方法体执行

```
const pro1 = new Promise(resolve=>resolve(100)}) // 执行同步任务
pro.then(()=>pro1).then(data => console.log(data)).catch(err => {});
// 输出结果: 正常打印了100，data并不是当前的pro1对象
```
但是如果pro1内部是同步任务，立即执行的话，当前的self._state === 1，即调过 push 到_deferreds数组的操作，执行最后的onFulfilled, onRejected回调,**onFulfilled, onRejected会被放入到事件循环队列里面执行**，即执行到了Promise._immediateFn

Promise._immediateFn回调函数放到了事件循环队列里面来执行
这里的deferred对象存放了当前的onFulfilled和onRejected回调函数和下一个 promise 对象。
当前对象的onFulfilled和onRejected如果存在时，则执行自己的回调；
```
pro.then(data => data}).then(data => data).catch(err => {});
// 正确写法: 输出两次  data 
```
**注意**：then 方法一定要做 return 下一个值的操作，因为当前的 ret 值会被带入到下一个 Promise 对象,即 resolve(deferred.promise, ret)。如果不提供返回值，则第二个 then 的 data 会变成 undefined，即这样的错误写法
```
pro.then(data => {}}).then(data => data).catch(err => {});
// 错误写法: 第二个 then 方法的 data 为 undefined
```

如果onFulfilled和onRejected回调不存在，则执行下一个 promise 的回调并携带当前的_value 值。即可以这样写
```
pro.then().then().then().then(data => {}).catch(err => {});
// 正确写法: 第四个 then 方法仍然能取到第一个pro 的内部_value 值
// 当然前面的三个 then 写起来毫无用处

```
所以针对下面的情况：当第一个 then 提供了 reject 回调，后面又跟了个 catch 方法。
当 reject 时，会优先执行第一个 Promise 的onRejected回调函数，catch 是在下一个 Promise 对象上的捕获错误方法
```
pro.then(data => data,err => err).catch(err => err);
```

最终总结:**resolve 要么提供带返回值的回调，要么不提供回调函数**

### 静态方法：race
```
Promise.race = function(values) {
  return new Promise(function(resolve, reject) {
    for (var i = 0, len = values.length; i < len; i++) {
      // 因为doResolve方法内部 done 变量控制了对 resolve reject 方法只执行一次的处理
      // 所以这里实现很简单，清晰明了，最快的 Promise 执行了  resolve||reject，后面相对慢的 // Promise都不执行
      values[i].then(resolve, reject);
    }
  });
};
```
用法
```
Promise.race([pro1,pro2,pro3]).then()
```
race的实现非常巧妙，对当前的 values(必须是 Promise 数组) for 循环执行每个 Promise 的 then 方法，resolve, reject方法对于所有race中 promise 对象都是公用的，从而利用doResolve内部的 done变量，保证了最快执行的 Promise 能做 resolve reject 的回调，从而达到了多个Promise race 竞赛的机制，谁跑的快执行谁。

### 静态方法：all
```
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
```
用法
```
Promise.all([pro1,pro2,pro3]).then()
```
all 等待所有的 Promise 都执行完毕，才会执行 Promise.all().then()回调，只要其中一个出错，则直接进入错误回调，因为对于所有 all 中 promise 对象 reject 回调是公用的，利用doResolve内部的 done变量,保证一次错误终止所有操作。

但是对于 resolve 则不一样， resolve 回调函数通过 res 递归调用自己,从而保证其值_value不为 Promise 类型才结束，并将_value 赋值到 args 数组，最后直到所有的数组Promise都处理完毕由统一的 resolve 方法结束当前的 all 操作，进入 then 处理流程。

## 结束语

本篇针对 Promise 的所有 api 做了详细的代码解释和使用场景，篇幅可能过长，看起来比较费力，如果有写的不对的地方欢迎指正。

最后附上我的 github 源码注释版链接  [promise源码注释版](https://github.com/frontMoment/promise-polyfill-analyze)


