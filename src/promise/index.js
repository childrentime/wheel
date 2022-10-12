const asyncFn =
  typeof queueMicrotask !== undefined
    ? function (fn) {
        queueMicrotask(fn);
      }
    : typeof setImmediate !== "undefined"
    ? function (fn) {
        setImmediate(fn);
      }
    : typeof process !== "undefined" && process.nextTick
    ? process.nextTick
    : function (fn) {
        setTimeout(fn, 0);
      };

class Promise {
  #callbacks = [];
  #errbacks = [];
  #status = "pending";
  #result = null;

  constructor(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("Promise resolver " + fn + " is not a function");
    }

    try {
      fn(
        (value) => {
          // new promise的时候会调用resolve方法
          this.#resolve(value);
        },
        (reason) => {
          this.#reject(reason);
        }
      );
    } catch (error) {
      this.#reject(error);
    }
  }

  // 我们在这里添加callback
  // 如果添加回调的时候 promise已经被解决了 我们就立即执行回调
  then(callback, errback) {
    let resolve, reject;
    const promise = new Promise(function (res, rej) {
      resolve = res;
      reject = rej;
    });

    // 值的透传，如果我们没有传递 callback 需要将值传递到下一个callback
    this.#callbacks.push(
      typeof callback === "function"
        ? function (value) {
            let result;
            try {
              result = callback(value);
            } catch (error) {
              reject(error);
              return;
            }
            // 规范2.3.1 promise.then方法中不能返回自身
            // 如果返回自身 应该抛出type error
            /*
             ** eg:
             ** const promise = Promise.resolve(0).then(() => {
             **  return promise;
             ** });
             ** promise.then(null, function (reason) {
             **  console.log(reason);
             ** });
             */
            if (result === promise) {
              reject(new TypeError("Cannot resolve a promise with itself"));
              return;
            }
            resolve(result);
          }
        : resolve
    );
    this.#errbacks.push(
      typeof errback === "function"
        ? function (value) {
            let result;
            try {
              result = errback(value);
            } catch (error) {
              reject(error);
              return;
            }
            if (result === promise) {
              reject(new TypeError("Cannot resolve a promise with itself"));
              return;
            }
            resolve(result);
          }
        : reject
    );

    if (this.#status === "accepted") {
      this.#unwrap(this.#result);
    } else if (this.#status === "fulfilled") {
      this.#fulfill(this.#result);
    } else if (this.#status === "rejected") {
      this.#reject(this.#result);
    }

    return promise;
  }

  catch(errback) {
    return this.then(undefined, errback);
  }

  #unwrap(value) {
    let unwrapped = false;
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      this.#fulfill(value);
      return;
    }

    // 我们不能get两次 value.then
    /* eg:
     ** const promise = Promise.resolve(100).then(function onBasePromiseFulfilled() {
     **  return Object.create(null, {
     **    then: {
     **      get: function () {
     **        console.log("should not exec twice");
     **        return function thenMethodForX(onFulfilled) {
     **        onFulfilled();
     **       };
     **    },
     **   },
     **  });
     ** });
     ** promise.then(function () {});
     **
     */
    try {
      const then = value.then;
      if (typeof then === "function") {
        then.call(
          value,
          (value) => {
            // 防止.then为自定义对象的时候多次执行resolve
            // 加锁只返回第一次resolve的结果
            if (!unwrapped) {
              unwrapped = true;
              this.#unwrap(value);
            }
          },
          (reason) => {
            if (!unwrapped) {
              unwrapped = true;
              this.#reject(reason);
            }
          }
        );
      } else {
        this.#fulfill(value);
      }
    } catch (error) {
      // 一个promise被fulfilled之后 还有可能继续执行reject
      // eg: .then方法中同时有 resolve和throw代码
      // 所以 resolve方法执行完成之后 我们需要将promise的状态设置为中间态！
      if (!unwrapped) {
        this.#reject(error);
      }
    }
  }

  #resolve(value) {
    if (this.#status === "pending") {
      this.#status = "accepted";
      this.#result = value;
      // 如果没有.then回调 不必解包装值
      if (this.#callbacks.length) {
        this.#unwrap(value);
      }
    }
  }

  #fulfill(value) {
    if (this.#status === "pending" || this.#status === "accepted") {
      this.#result = value;
      this.#status = "fulfilled";
    }

    if (this.#status === "fulfilled") {
      this.#notify(this.#callbacks);
    }
  }

  #reject(reason) {
    // resolve的值可能是一个被拒绝的promise
    // 所以一个promise对象resolve之后 还有可能执行reject方法
    /*
     ** const promise = Promise.resolve(100).then(function onBasePromiseFulfilled() {
     **  return Promise.reject("test");
     ** });
     ** promise.then(null, function onPromiseRejected(reason) {
     **  console.log(reason);
     ** });
     */

    if (this.#status === "pending" || this.#status === "accepted") {
      this.#result = reason;
      this.#status = "rejected";
    }

    if (this.#status === "rejected") {
      this.#notify(this.#errbacks);
    }
  }

  // notify完成之后 需要清空数组
  // 不然有可能发生死循环
  /* eg:
   ** const promise = Promise.resolve(0);
   **
   ** promise.then(function taskA() {
   **  promise.then(function taskB() {
   **   console.log("taskB");
   **  });
   ** });
   */
  #notify(arrs) {
    if (arrs.length) {
      asyncFn(() => {
        for (let i = 0; i < arrs.length; i++) {
          arrs[i](this.#result);
        }
      });
      this.#callbacks = [];
      this.#errbacks = [];
    }
  }

  static reject(reason) {
    const promise = new Promise(() => {});
    promise.#result = reason;
    promise.#status = "rejected";
    return promise;
  }

  static resolve(value) {
    if (value && value.constructor === this) {
      return value;
    }
    const promise = new Promise(function (resolve) {
      resolve(value);
    });
    return promise;
  }

  static deferred() {
    let dfd = {};
    dfd.promise = new Promise((resolve, reject) => {
      dfd.resolve = resolve;
      dfd.reject = reject;
    });
    return dfd;
  }
}

module.exports = Promise;
