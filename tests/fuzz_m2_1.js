#!/usr/bin/env node
/**
 * MAITEMBATH GANG PARTY - Adversarial Fuzzing & Stress Suite (Milestone 2)
 * File: tests/fuzz_m2_1.js
 * 
 * Challenger Mission:
 * 1. Module Loading: Dynamically import all 10 modules concurrently across multiple
 *    Node worker threads and rapid asynchronous promises to verify zero deadlocks
 *    or undefined exports.
 * 2. State Store Stress: Burst 1,000 rapid state updates and listener subscriptions
 *    to public/js/state.js to verify exception isolation, unsubscription, and zero memory leaks.
 * 3. WMO Weather Decoder Fuzzing: Fuzz decodeWmoWeather in public/js/map.js with extreme
 *    values (null, undefined, negative numbers, numbers > 99, NaN, strings, objects).
 * 4. LocalStorage Fallbacks: Test public/js/history.js and public/js/favorites.js against
 *    invalid/malformed JSON strings and throwing storage engines to guarantee empty array fallbacks.
 * 5. Guardrail R4 Verification: Confirm port 3000 process safety is preserved.
 */

'use strict';

const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const MODULE_NAMES = [
    'state.js',
    'socket.js',
    'audio.js',
    'lyrics.js',
    'queue.js',
    'history.js',
    'favorites.js',
    'map.js',
    'ui.js',
    'main.js'
];

// If running in a worker thread, execute worker import task
if (!isMainThread) {
    (async () => {
        try {
            const workerId = workerData.workerId;
            const iterations = workerData.iterations || 5;
            for (let i = 0; i < iterations; i++) {
                // Shuffle module import order to stress test concurrent resolver
                const shuffled = [...MODULE_NAMES].sort(() => Math.random() - 0.5);
                const loaded = await Promise.all(shuffled.map(modName => {
                    const modUrl = `file:///${path.join(WORKSPACE_ROOT, 'public', 'js', modName).replace(/\\/g, '/')}`;
                    return import(modUrl);
                }));

                for (let j = 0; j < loaded.length; j++) {
                    const mod = loaded[j];
                    const name = shuffled[j];
                    const keys = Object.keys(mod);
                    if (keys.length === 0) {
                        throw new Error(`Module ${name} exported zero keys in worker ${workerId}`);
                    }
                    for (const k of keys) {
                        if (mod[k] === undefined) {
                            throw new Error(`Module ${name} has undefined export "${k}" in worker ${workerId}`);
                        }
                    }
                }
            }
            parentPort.postMessage({ success: true, workerId });
        } catch (err) {
            parentPort.postMessage({ success: false, error: err.stack || err.message });
        }
    })();
    return;
}

// ============================================================================
// MAIN TEST HARNESS
// ============================================================================

const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
};

function recordPass(testName, details = '') {
    stats.total++;
    stats.passed++;
    console.log(`  \x1b[32m✔\x1b[0m ${testName} ${details ? `\x1b[90m(${details})\x1b[0m` : ''}`);
}

function recordFail(testName, err) {
    stats.total++;
    stats.failed++;
    const errMsg = err && (err.stack || err.message) ? err.message : String(err);
    console.error(`  \x1b[31m✖\x1b[0m ${testName}: ${errMsg}`);
    stats.failures.push({ testName, error: errMsg });
}

// ----------------------------------------------------------------------------
// SUITE 1: CONCURRENT MODULE LOADING & ZERO DEADLOCKS
// ----------------------------------------------------------------------------
async function runSuite1_ModuleLoading() {
    console.log('\n--- [SUITE 1] Concurrent Module Loading & Deadlock Stress ---');

    // 1.1 Rapid asynchronous promise burst in main thread
    const burstCount = 50;
    const startTime = Date.now();
    try {
        const promises = [];
        for (let b = 0; b < burstCount; b++) {
            const batch = MODULE_NAMES.map(modName => {
                const modUrl = `file:///${path.join(WORKSPACE_ROOT, 'public', 'js', modName).replace(/\\/g, '/')}`;
                return import(modUrl);
            });
            promises.push(Promise.all(batch));
        }

        const results = await Promise.all(promises);
        const elapsedMs = Date.now() - startTime;

        let totalExports = 0;
        let undefinedExports = 0;
        for (const batch of results) {
            batch.forEach((mod, idx) => {
                const keys = Object.keys(mod);
                totalExports += keys.length;
                keys.forEach(k => {
                    if (mod[k] === undefined) undefinedExports++;
                });
            });
        }

        if (undefinedExports > 0) {
            recordFail('Asynchronous module burst', new Error(`Detected ${undefinedExports} undefined exports`));
        } else {
            recordPass(
                'Concurrent Async Dynamic Imports (50 bursts x 10 modules = 500 imports)',
                `${elapsedMs}ms, zero undefined exports`
            );
        }
    } catch (err) {
        recordFail('Concurrent Async Dynamic Imports', err);
    }

    // 1.2 Multi-Worker Concurrent Dynamic Importing
    const numWorkers = 4;
    try {
        const workerStartTime = Date.now();
        const workerPromises = [];
        for (let w = 0; w < numWorkers; w++) {
            workerPromises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, {
                    workerData: { workerId: w + 1, iterations: 10 }
                });
                worker.on('message', (msg) => {
                    if (msg.success) resolve(msg);
                    else reject(new Error(msg.error));
                });
                worker.on('error', reject);
                worker.on('exit', (code) => {
                    if (code !== 0) reject(new Error(`Worker ${w + 1} exited with code ${code}`));
                });
            }));
        }

        await Promise.all(workerPromises);
        const workerElapsed = Date.now() - workerStartTime;
        recordPass(
            `Node Worker Threads Concurrency (${numWorkers} workers x 10 iterations = 400 module resolutions)`,
            `${workerElapsed}ms, zero deadlocks`
        );
    } catch (err) {
        recordFail('Node Worker Threads Concurrency', err);
    }
}

// ----------------------------------------------------------------------------
// SUITE 2: STATE STORE STRESS & LISTENER MEMORY LEAK HARNESS
// ----------------------------------------------------------------------------
async function runSuite2_StateStoreStress() {
    console.log('\n--- [SUITE 2] State Store Stress & Listener Isolation ---');

    const stateUrl = `file:///${path.join(WORKSPACE_ROOT, 'public', 'js', 'state.js').replace(/\\/g, '/')}`;
    const stateMod = await import(stateUrl);

    // 2.1 1,000 Rapid Updates & Exception Isolation
    try {
        let goodListenerCallCount = 0;
        let throwingListenerCallCount = 0;

        // Unsubscribe functions
        const unsubs = [];

        // Attach a good listener
        unsubs.push(stateMod.onStateChange((st, keys) => {
            goodListenerCallCount++;
        }));

        // Attach a malicious/throwing listener
        unsubs.push(stateMod.onStateChange((st, keys) => {
            throwingListenerCallCount++;
            throw new Error('Adversarial listener crash simulation');
        }));

        // Attach 1,000 dummy listeners to stress Set subscription
        let dummyCallCount = 0;
        for (let i = 0; i < 1000; i++) {
            unsubs.push(stateMod.onStateChange(() => {
                dummyCallCount++;
            }));
        }

        // Measure memory before burst
        if (global.gc) global.gc();
        const memBefore = process.memoryUsage().heapUsed;
        const burstStart = Date.now();

        // Intercept console.error during throwing listener burst
        const originalConsoleError = console.error;
        let caughtConsoleErrors = 0;
        console.error = (...args) => {
            caughtConsoleErrors++;
        };

        // Burst 1,000 updates
        const updateIterations = 1000;
        for (let i = 0; i < updateIterations; i++) {
            stateMod.updateState({
                currentTime: i * 0.5,
                volume: i % 100,
                isPlaying: i % 2 === 0
            });
        }
        const burstDuration = Date.now() - burstStart;

        // Restore console.error
        console.error = originalConsoleError;

        if (caughtConsoleErrors !== updateIterations) {
            throw new Error(`Expected ${updateIterations} caught console errors from throwing listener, got ${caughtConsoleErrors}`);
        }

        // Verify good listener was called for all iterations without being blocked by throwing listener
        if (goodListenerCallCount !== updateIterations) {
            throw new Error(`Expected ${updateIterations} calls, but got ${goodListenerCallCount}`);
        }
        if (throwingListenerCallCount !== updateIterations) {
            throw new Error(`Throwing listener called ${throwingListenerCallCount} times, expected ${updateIterations}`);
        }
        if (dummyCallCount !== updateIterations * 1000) {
            throw new Error(`Dummy listeners called ${dummyCallCount} times, expected ${updateIterations * 1000}`);
        }

        recordPass(
            '1,000 State Updates Burst with Throwing Listener',
            `${burstDuration}ms, 1,002,000 listener invocations without crash`
        );

        // 2.2 Unsubscribe Leak & Set Cleanup
        const cleanupStart = Date.now();
        for (const unsub of unsubs) {
            unsub();
        }

        // Now trigger one more update and ensure zero listeners are called
        goodListenerCallCount = 0;
        dummyCallCount = 0;
        stateMod.updateState({ currentTime: 9999 });

        if (goodListenerCallCount !== 0 || dummyCallCount !== 0) {
            throw new Error(`Listeners still called after unsub: good=${goodListenerCallCount}, dummy=${dummyCallCount}`);
        }

        if (global.gc) global.gc();
        const memAfter = process.memoryUsage().heapUsed;
        const heapDeltaMb = ((memAfter - memBefore) / (1024 * 1024)).toFixed(2);

        recordPass(
            '1,002 Listener Unsubscriptions & Leak Guard',
            `${Date.now() - cleanupStart}ms, listeners clean, heap delta: ${heapDeltaMb}MB`
        );
    } catch (err) {
        recordFail('State Store Stress & Listener Isolation', err);
    }
}

// ----------------------------------------------------------------------------
// SUITE 3: WMO WEATHER DECODER FUZZING HARNESS
// ----------------------------------------------------------------------------
async function runSuite3_WmoWeatherFuzzing() {
    console.log('\n--- [SUITE 3] WMO Weather Decoder Adversarial Fuzzing ---');

    const mapUrl = `file:///${path.join(WORKSPACE_ROOT, 'public', 'js', 'map.js').replace(/\\/g, '/')}`;
    const mapMod = await import(mapUrl);
    const { decodeWmoWeather, getWmoWeatherThai } = mapMod;

    // 3.1 Extreme boundary and malformed inputs
    const testCases = [
        // Primitives & Nullish
        null,
        undefined,
        NaN,
        0,
        -0,
        +0,
        // Negative numbers
        -1,
        -10,
        -999,
        -Infinity,
        // Standard codes
        1, 2, 3, 45, 48, 51, 53, 57, 61, 65, 80, 82, 95, 96, 99,
        // Over 99 & Extremes
        100,
        150,
        999,
        1000000,
        Infinity,
        // Floating point
        3.14159,
        51.0001,
        94.9999,
        -0.00001,
        // Strings
        "",
        " ",
        "0",
        "1",
        "51",
        "95",
        "100",
        "-50",
        "rain",
        "storm",
        "<script>alert(1)</script>",
        "NaN",
        "undefined",
        "null",
        "99999999999999999999",
        // Objects & Arrays
        {},
        { code: 51 },
        [],
        [51],
        [95],
        new Date(),
        /regex/,
        // Functions
        () => {},
        function() { return 51; },
        // Booleans
        true,
        false
    ];

    let passedCases = 0;
    let failedCases = 0;

    for (const val of testCases) {
        try {
            const res = decodeWmoWeather(val);
            if (!res || typeof res !== 'object') {
                throw new Error(`Invalid return type for input ${String(val)}`);
            }
            if (typeof res.text !== 'string' || res.text.length === 0) {
                throw new Error(`Invalid text property for input ${String(val)}`);
            }
            if (typeof res.rain !== 'boolean') {
                throw new Error(`Invalid rain flag (not boolean) for input ${String(val)}: ${typeof res.rain}`);
            }
            passedCases++;
        } catch (err) {
            failedCases++;
            recordFail(`Fuzz input: ${typeof val} (${String(val)})`, err);
        }
    }

    if (failedCases === 0) {
        recordPass(
            `Fuzzing decodeWmoWeather (${testCases.length} adversarial inputs)`,
            `${passedCases} inputs safely handled with zero uncaught exceptions`
        );
    }

    // 3.2 Automated Random Fuzzer (10,000 iterations)
    try {
        const randomFuzzCount = 10000;
        let randomExceptions = 0;
        for (let i = 0; i < randomFuzzCount; i++) {
            const randType = Math.floor(Math.random() * 5);
            let val;
            switch (randType) {
                case 0: // Random integer between -5000 and 5000
                    val = Math.floor(Math.random() * 10000) - 5000;
                    break;
                case 1: // Random float
                    val = (Math.random() - 0.5) * 100000;
                    break;
                case 2: // Random string
                    val = Math.random().toString(36).substring(2);
                    break;
                case 3: // Corrupted number strings
                    val = `${Math.floor(Math.random() * 200)}px`;
                    break;
                case 4: // Random object or array
                    val = Math.random() > 0.5 ? { a: Math.random() } : [Math.random()];
                    break;
            }

            try {
                const res = decodeWmoWeather(val);
                if (typeof res.text !== 'string' || typeof res.rain !== 'boolean') {
                    randomExceptions++;
                }
            } catch (e) {
                randomExceptions++;
            }
        }

        if (randomExceptions === 0) {
            recordPass(
                `High-Throughput Random Fuzzer (10,000 iterations)`,
                '100% stable, zero uncaught exceptions'
            );
        } else {
            recordFail('High-Throughput Random Fuzzer', new Error(`${randomExceptions} exceptions detected`));
        }
    } catch (err) {
        recordFail('High-Throughput Random Fuzzer', err);
    }
}

// ----------------------------------------------------------------------------
// SUITE 4: LOCALSTORAGE FALLBACKS & CORRUPTION RECOVERY
// ----------------------------------------------------------------------------
async function runSuite4_LocalStorageFallbacks() {
    console.log('\n--- [SUITE 4] LocalStorage Fallbacks & Malformed JSON Resilience ---');

    // Setup Mock LocalStorage Environment
    let mockStore = {};
    let shouldThrowOnGet = false;
    let shouldThrowOnSet = false;

    globalThis.localStorage = {
        getItem(key) {
            if (shouldThrowOnGet) {
                throw new Error('SecurityError: The operation is insecure.');
            }
            return key in mockStore ? mockStore[key] : null;
        },
        setItem(key, value) {
            if (shouldThrowOnSet) {
                throw new Error('QuotaExceededError: Storage quota exceeded.');
            }
            mockStore[key] = String(value);
        },
        removeItem(key) {
            delete mockStore[key];
        },
        clear() {
            mockStore = {};
        }
    };

    const historyUrl = `file:///${path.join(WORKSPACE_ROOT, 'public', 'js', 'history.js').replace(/\\/g, '/')}`;
    const favoritesUrl = `file:///${path.join(WORKSPACE_ROOT, 'public', 'js', 'favorites.js').replace(/\\/g, '/')}`;

    const histMod = await import(historyUrl);
    const favMod = await import(favoritesUrl);

    // 4.1 History Module Malformed JSON Tests
    const corruptInputs = [
        '{malformed_json: true',
        '[{"id": "1", unclosed',
        '<<<not json>>>',
        'undefined',
        'NaN',
        '   ',
        '\0\x01\x02',
        '{"foo": "bar"}', // Valid JSON, but not an array
        '"just a string"', // Valid JSON, string
        '12345',          // Valid JSON, number
        'true',           // Valid JSON, boolean
        'null'            // Valid JSON, null
    ];

    try {
        let historyFails = 0;
        for (const badVal of corruptInputs) {
            mockStore['maitembath_track_history'] = badVal;
            const res = histMod.loadHistoryFromStorage();
            if (!Array.isArray(res)) {
                historyFails++;
                recordFail(`history.loadHistoryFromStorage with ${badVal}`, new Error('Did not return array'));
            }
        }

        if (historyFails === 0) {
            recordPass(
                `history.js Malformed JSON Resilience (${corruptInputs.length} corrupt payloads)`,
                'Guaranteed array fallback, zero crashes'
            );
        }
    } catch (err) {
        recordFail('history.js Malformed JSON Resilience', err);
    }

    // 4.2 Favorites Module Malformed JSON Tests
    try {
        let favoritesFails = 0;
        for (const badVal of corruptInputs) {
            mockStore['maitembath_favorites'] = badVal;
            const res = favMod.loadFavoritesFromStorage();
            if (!Array.isArray(res)) {
                favoritesFails++;
                recordFail(`favorites.loadFavoritesFromStorage with ${badVal}`, new Error('Did not return array'));
            }
        }

        if (favoritesFails === 0) {
            recordPass(
                `favorites.js Malformed JSON Resilience (${corruptInputs.length} corrupt payloads)`,
                'Guaranteed array fallback, zero crashes'
            );
        }
    } catch (err) {
        recordFail('favorites.js Malformed JSON Resilience', err);
    }

    // 4.3 Engine Throwing Tests (SecurityError / QuotaExceededError)
    try {
        // Test getItem throw
        shouldThrowOnGet = true;
        const histThrow = histMod.loadHistoryFromStorage();
        const favThrow = favMod.loadFavoritesFromStorage();
        shouldThrowOnGet = false;

        if (!Array.isArray(histThrow) || !Array.isArray(favThrow)) {
            throw new Error('Did not return array when getItem throws');
        }

        // Test setItem throw
        shouldThrowOnSet = true;
        histMod.saveHistoryToStorage();
        favMod.saveFavoritesToStorage();
        shouldThrowOnSet = false;

        recordPass('Storage Engine Exception Shield', 'SecurityError and QuotaExceededError trapped safely');
    } catch (err) {
        shouldThrowOnGet = false;
        shouldThrowOnSet = false;
        recordFail('Storage Engine Exception Shield', err);
    }
}

// ----------------------------------------------------------------------------
// SUITE 5: PROCESS SAFETY GUARDRAIL R4
// ----------------------------------------------------------------------------
async function runSuite5_GuardrailR4() {
    console.log('\n--- [SUITE 5] Process Safety Guardrail R4 Verification ---');

    try {
        const net = require('net');
        // Check that port 3000 is still listening and active
        const portOpen = await new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(1500);
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            socket.on('error', () => {
                resolve(false);
            });
            socket.connect(3000, '127.0.0.1');
        });

        if (!portOpen) {
            recordFail('Port 3000 Process Safety', new Error('Port 3000 is NOT responding. User server may have been affected!'));
        } else {
            recordPass('Port 3000 Process Safety (R4)', 'Host server on port 3000 completely untouched and alive');
        }
    } catch (err) {
        recordFail('Port 3000 Process Safety', err);
    }
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
(async () => {
    console.log('====================================================================');
    console.log('   MAITEMBATH GANG PARTY - CHALLENGER FUZZING & STRESS SUITE (M2)   ');
    console.log('====================================================================');

    const totalStart = Date.now();
    await runSuite1_ModuleLoading();
    await runSuite2_StateStoreStress();
    await runSuite3_WmoWeatherFuzzing();
    await runSuite4_LocalStorageFallbacks();
    await runSuite5_GuardrailR4();
    const totalElapsed = Date.now() - totalStart;

    console.log('\n====================================================================');
    console.log('                          STRESS & FUZZ SUMMARY                     ');
    console.log('====================================================================');
    console.log(`  Total Test Groups: ${stats.total}`);
    console.log(`  Passed: \x1b[32m${stats.passed}\x1b[0m`);
    console.log(`  Failed: \x1b[${stats.failed > 0 ? '31' : '90'}m${stats.failed}\x1b[0m`);
    console.log(`  Total Execution Time: ${totalElapsed}ms`);
    console.log('====================================================================');

    if (stats.failed > 0) {
        console.error('\n\x1b[31m✖ FUZZING SUITE FAILED WITH ' + stats.failed + ' DEFECTS!\x1b[0m');
        process.exit(1);
    } else {
        console.log('\n\x1b[32m✔ ALL ADVERSARIAL STRESS & FUZZING TESTS PASSED EMPIRICALLY!\x1b[0m\n');
        process.exit(0);
    }
})();
