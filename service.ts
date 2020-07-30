// Hydro Integration
/* eslint-disable no-await-in-loop */
import 'hydrooj';
import path from 'path';
import cluster from 'cluster';
import child from 'child_process';
import { ObjectID } from 'bson';
import yaml from 'js-yaml';
import fs from 'fs-extra';

async function postInit() {
    // Only start a single daemon
    if (!cluster.isFirstWorker) return;
    const config = require('./judge/config');
    const log = require('./judge/log');
    log.logger(global.Hydro.lib.logger);
    config.LANGS = yaml.safeLoad(await global.Hydro.model.system.get('judge.langs'));
    const { compilerText } = require('./judge/utils');
    const tmpfs = require('./judge/tmpfs');
    const { FormatError, CompileError, SystemError } = require('./judge/error');
    const { STATUS_COMPILE_ERROR, STATUS_SYSTEM_ERROR } = require('./judge/status');
    const readCases = require('./judge/cases');
    const judge = require('./judge/judge');
    const sysinfo = require('./judge/sysinfo');

    const { problem, file, task } = global.Hydro.model;
    const { judge: _judge } = global.Hydro.handler;
    const { monitor } = global.Hydro.service;

    const info = await sysinfo.get();
    monitor.updateJudger(info);
    setInterval(async () => {
        const [mid, info] = await sysinfo.update();
        monitor.updateJudger({ mid, ...info });
    }, 1200000);

    async function processData(folder: string) {
        let files = await fs.readdir(folder);
        let ini = false;
        for (const i of files) {
            if (i.toLowerCase() === 'config.ini') {
                ini = true;
                await fs.rename(`${folder}/${i}`, `${folder}/config.ini`);
                break;
            }
        }
        if (ini) {
            for (const i of files) {
                if (i.toLowerCase() === 'input') await fs.rename(`${folder}/${i}`, `${folder}/input`);
                else if (i.toLowerCase() === 'output') await fs.rename(`${folder}/${i}`, `${folder}/output`);
            }
            files = await fs.readdir(`${folder}/input`);
            for (const i of files) await fs.rename(`${folder}/input/${i}`, `${folder}/input/${i.toLowerCase()}`);
            files = await fs.readdir(`${folder}/output`);
            for (const i of files) await fs.rename(`${folder}/output/${i}`, `${folder}/output/${i.toLowerCase()}`);
        }
    }

    async function problemData(domainId: string, pid: string, savePath: string) {
        const tmpFilePath = path.resolve(config.CACHE_DIR, `download_${domainId}_${pid}`);
        const pdoc = await problem.get(domainId, pid);
        const data = await file.get(pdoc.data);
        if (!data) throw new SystemError('Problem data not found.');
        const w = fs.createWriteStream(tmpFilePath);
        data.pipe(w);
        await new Promise((resolve, reject) => {
            w.on('finish', resolve);
            w.on('error', reject);
        });
        fs.ensureDirSync(path.dirname(savePath));
        await new Promise((resolve, reject) => {
            child.exec(`unzip ${tmpFilePath} -d ${savePath}`, (e) => {
                if (e) reject(e);
                else resolve();
            });
        });
        await fs.unlink(tmpFilePath);
        await processData(savePath).catch();
        return savePath;
    }

    async function cacheOpen(domainId: string, pid: string, version: string) {
        const filePath = path.join(config.CACHE_DIR, domainId, pid);
        if (fs.existsSync(filePath)) {
            let ver: string;
            try {
                ver = fs.readFileSync(path.join(filePath, 'version')).toString();
            } catch (e) { /* ignore */ }
            if (version === ver) return filePath;
            fs.removeSync(filePath);
        }
        fs.ensureDirSync(filePath);
        await problemData(domainId, pid, filePath);
        fs.writeFileSync(path.join(filePath, 'version'), version);
        return filePath;
    }

    function getNext(that) {
        that.nextId = 1;
        that.nextWaiting = [];
        return (data, id) => {
            data.domainId = that.domainId;
            data.rid = new ObjectID(that.rid);
            data.time = data.time_ms || data.time;
            data.memory = data.memory_kb || data.memory;
            data.message = data.judge_text || data.message;
            data.compilerText = data.compiler_text || data.compilerText;
            if (data.case) {
                data.case = {
                    status: data.case.status,
                    time: data.case.time_ms || data.case.time,
                    memory: data.case.memory_kb || data.case.memory,
                    message: data.judge_text || data.message || data.judgeText,
                };
            }
            if (id) {
                if (id === that.nextId) {
                    _judge.next(data);
                    that.nextId++;
                    let t = true;
                    while (t) {
                        t = false;
                        for (const i in that.nextWaiting) {
                            if (that.nextId === that.nextWaiting[i].id) {
                                _judge.next(that.nextWaiting[i].data);
                                that.nextId++;
                                that.nextWaiting.splice(i, 1);
                                t = true;
                            }
                        }
                    }
                } else that.nextWaiting.push({ data, id });
            } else _judge.next(data);
        };
    }

    function getEnd(domainId: string, rid: string) {
        return (data) => {
            data.key = 'end';
            data.rid = new ObjectID(rid);
            data.domainId = domainId;
            data.time = data.time_ms || data.time;
            data.memory = data.memory_kb || data.memory;
            log.log({
                status: data.status,
                score: data.score,
                time_ms: data.time_ms,
                memory_kb: data.memory_kb,
            });
            _judge.end(data);
        };
    }

    class JudgeTask {
        stat: any;
        request: any;
        event: string;
        pid: string;
        rid: string;
        domainId: string;
        lang: string;
        code: string;
        data: string;
        config: any;
        next: (data: any, id?: any) => void;
        end: (data: any) => void;
        tmpdir: string;
        clean: any[];
        folder: string;
        constructor(request) {
            this.stat = {};
            this.stat.receive = new Date();
            this.request = request;
        }

        async handle() {
            try {
                this.stat.handle = new Date();
                this.pid = (this.request.pid || 'unknown').toString();
                this.rid = this.request.rid.toString();
                this.domainId = this.request.domainId;
                this.lang = this.request.lang;
                this.code = this.request.code;
                this.data = this.request.data;
                this.config = this.request.config;
                this.next = getNext(this);
                this.end = getEnd(this.domainId, this.rid);
                this.tmpdir = path.resolve(config.TEMP_DIR, 'tmp', this.rid);
                this.clean = [];
                fs.ensureDirSync(this.tmpdir);
                tmpfs.mount(this.tmpdir, '64m');
                log.submission(`${this.rid}`, { pid: this.pid });
                if (this.config.input) await this.run();
                else await this.submission();
            } catch (e) {
                if (e instanceof CompileError) {
                    this.next({ compiler_text: compilerText(e.stdout, e.stderr) });
                    this.end({
                        status: STATUS_COMPILE_ERROR, score: 0, time_ms: 0, memory_kb: 0,
                    });
                } else if (e instanceof FormatError) {
                    this.next({ judge_text: `${e.message}\n${JSON.stringify(e.params)}` });
                    this.end({
                        status: STATUS_SYSTEM_ERROR, score: 0, time_ms: 0, memory_kb: 0,
                    });
                } else {
                    log.error(e);
                    this.next({ judge_text: `${e.message}\n${e.stack}\n${JSON.stringify(e.params)}` });
                    this.end({
                        status: STATUS_SYSTEM_ERROR, score: 0, time_ms: 0, memory_kb: 0,
                    });
                }
            }
            // eslint-disable-next-line no-await-in-loop
            for (const clean of this.clean) await clean().catch();
            tmpfs.umount(this.tmpdir);
            fs.removeSync(this.tmpdir);
        }

        async submission() {
            this.stat.cache_start = new Date();
            this.folder = await cacheOpen(this.domainId, this.pid, this.data);
            this.stat.read_cases = new Date();
            this.config = await readCases(
                this.folder,
                { detail: true },
                { next: this.next },
            );
            this.stat.judge = new Date();
            await judge[this.config.type || 'default'].judge(this);
        }

        async run() {
            this.stat.judge = new Date();
            await judge.run.judge(this);
        }
    }

    task.consume({ type: 'judge' }, (t) => (new JudgeTask(t)).handle().catch((e) => log.error(e)));
}

global.Hydro.postInit.push(postInit);
