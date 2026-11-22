// keeps the bot within telegram's limits, so it doesn't get rate limited:
// about 30 messages per second in total, about one per second in a private
// chat and about 20 per minute in a group. every message, edit and upload
// waits here for its turn.
//
// - users' messages go before broadcasts (priority "low").
// - edits of the same message replace each other while they wait, so only
//   the latest status is sent.
// - when telegram still answers "too many requests" (429), the chat waits
//   as long as telegram asks, then the request is tried again.

export const DEFAULT_LIMITS = {
    // requests per second in total (telegram allows about 30)
    perSecond: 25,
    // time between requests to one private chat
    privateInterval: 1000,
    // time between requests to one group (20 per minute)
    groupInterval: 3000,
    // how often a request is tried again after "too many requests"
    retries: 3,
};

export class Limiter {
    #limits;
    #queues = { high: [], low: [] };
    #nextFree = new Map(); // chat -> time it can get the next request
    #tokens;
    #lastRefill = Date.now();
    #pausedUntil = 0;
    #wake;
    #running = false;

    constructor(limits = {}) {
        this.#limits = { ...DEFAULT_LIMITS, ...limits };
        this.#tokens = this.#limits.perSecond;
    }

    get pending() {
        return this.#queues.high.length + this.#queues.low.length;
    }

    // runs fn when the chat and the global limit allow it.
    // a task with a key replaces a waiting task with the same key.
    schedule(chatId, fn, { priority = "high", key } = {}) {
        return new Promise((resolve, reject) => {
            const queue = this.#queues[priority === "low" ? "low" : "high"];

            if (key) {
                const waiting = queue.find(task => task.key === key);
                if (waiting) {
                    // the older one is dropped, only the newest is sent
                    waiting.resolve(undefined);
                    Object.assign(waiting, { fn, resolve, reject, attempts: 0 });
                    return;
                }
            }

            queue.push({ chatId, fn, resolve, reject, key, priority, attempts: 0 });
            this.#start();
        });
    }

    #interval(chatId) {
        // group and channel ids are negative
        return Number(chatId) < 0 ? this.#limits.groupInterval : this.#limits.privateInterval;
    }

    #refill() {
        const now = Date.now();
        this.#tokens = Math.min(
            this.#limits.perSecond,
            this.#tokens + (now - this.#lastRefill) / 1000 * this.#limits.perSecond,
        );
        this.#lastRefill = now;
    }

    // the first task (users' before broadcasts) whose chat is free
    #next(now) {
        for (const queue of [this.#queues.high, this.#queues.low]) {
            const index = queue.findIndex(task => (this.#nextFree.get(task.chatId) ?? 0) <= now);
            if (index !== -1) return queue.splice(index, 1)[0];
        }
    }

    // time until any waiting task could run. chats with a request in
    // progress wake the loop up when it's done.
    #waitTime(now) {
        let soonest = 60000;
        for (const task of [...this.#queues.high, ...this.#queues.low]) {
            soonest = Math.min(soonest, (this.#nextFree.get(task.chatId) ?? 0) - now);
        }
        return Math.max(soonest, 1);
    }

    #start() {
        if (this.#running) {
            this.#wake?.();
            return;
        }
        this.#running = true;
        this.#loop();
    }

    async #loop() {
        while (true) {
            if (!this.pending) {
                // set in the same step that sees the queue empty (not a tick
                // later), so a task that arrives next starts a new loop
                this.#running = false;
                return;
            }

            const now = Date.now();

            if (now < this.#pausedUntil) {
                await this.#sleep(this.#pausedUntil - now);
                continue;
            }

            this.#refill();
            if (this.#tokens < 1) {
                await this.#sleep((1 - this.#tokens) / this.#limits.perSecond * 1000);
                continue;
            }

            const task = this.#next(now);
            if (!task) {
                await this.#sleep(this.#waitTime(now));
                continue;
            }

            this.#tokens -= 1;
            this.#run(task, now);

            // forget chats that are free again
            if (this.#nextFree.size > 5000) {
                for (const [chat, time] of this.#nextFree) {
                    if (time < now) this.#nextFree.delete(chat);
                }
            }
        }
    }

    // a sleep that ends early when a new task arrives or a chat is free again
    #sleep(ms) {
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                this.#wake = undefined;
                resolve();
            };
            const timer = setTimeout(done, ms);
            this.#wake = done;
        });
    }

    async #run(task, startedAt) {
        // requests to one chat run one after another, in order. the next
        // one can start when this one is done and the interval has passed.
        this.#nextFree.set(task.chatId, Infinity);
        const release = () => {
            this.#nextFree.set(task.chatId, Math.max(startedAt + this.#interval(task.chatId), Date.now()));
            this.#start();
        };

        try {
            task.resolve(await task.fn());
            release();
        } catch (e) {
            if (e?.code === 429 && task.attempts < this.#limits.retries) {
                task.attempts++;
                const wait = (e.retryAfter ?? 1) * 1000;

                // the chat waits as long as telegram asked. without a chat, everything does
                if (task.chatId === undefined) {
                    this.#pausedUntil = Math.max(this.#pausedUntil, Date.now() + wait);
                }
                this.#nextFree.set(task.chatId, Date.now() + wait);

                // tried again first, before anything else for the chat
                this.#queues[task.priority === "low" ? "low" : "high"].unshift(task);
                this.#start();
                return;
            }
            task.reject(e);
            release();
        }
    }
}
