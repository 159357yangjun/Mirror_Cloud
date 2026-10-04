#!/usr/bin/env node
/**
 * A stage that never finishes, for `node scripts/verify_all.mjs timeout-demo`.
 *
 * It exists to answer one question that "I set a timeout" cannot answer by itself: when the aggregate
 * kills a stage that overran its budget, does the browser that stage started die with it? So this is
 * not a sleeper - it starts a GRANDCHILD of its own and reports both pids, which is the shape a
 * harness-with-a-browser actually has. The outer `spawnSync({timeout})` terminates this process and
 * leaves the grandchild running unless something sweeps the tree; that leftover is the defect.
 *
 * No third-party imports, and nothing here is read by any gate - it is only ever spawned by the demo.
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const pidFile = process.argv[2]
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: false })
if (pidFile) writeFileSync(pidFile, JSON.stringify({ parent: process.pid, child: grandchild.pid }))
// Never resolves, so the only way this process ends is the budget firing.
setInterval(() => {}, 1000)
