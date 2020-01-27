import {get, post, patch} from 'request-promise'
import * as yaml from 'js-yaml'
import * as core from '@actions/core'

interface Chart {
    dependencies: Dependency[]
}

interface Dependency {
    name: string
    version: string
}

export class Committer {
    private baseTree = ''
    private parentCommit = ''
    private headers = {
        authorization: '',
        accept: 'application/vnd.github.v3+json',
        'User-Agent': 'release action'
    }

    constructor(
        private readonly owner: string,
        private readonly repo: string,
        private readonly branch: string,
        private readonly service: string,
        private readonly version: string,
        private readonly token: string,
        private readonly authorName: string,
        private readonly authorEmail: string
    ) {
        this.headers.authorization = `token ${token}`
    }

    async getChartYaml(): Promise<string> {
        // get ref
        let res = await get({
            uri: `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`,
            headers: this.headers,
            json: true
        })
        let {url} = res.object
        core.debug(url)

        // get commit
        res = await get({url, headers: this.headers, json: true})
        core.debug(res.tree.url)
        url = res.tree.url
        this.baseTree = res.tree.sha
        this.parentCommit = res.sha

        // get tree
        res = await get({url, headers: this.headers, json: true})
        // find the file
        let file = res.tree.find((v: any) => v.path === 'environment')
        url = file.url
        core.debug(url)
        res = await get({url, headers: this.headers, json: true})
        file = res.tree.find((v: any) => v.path === 'Chart.yaml')
        url = file.url
        core.debug(url)
        res = await get({url, headers: this.headers, json: true})
        const content = Buffer.from(res.content, 'base64').toString('utf-8')
        return content
    }

    updateChart(chart: Chart): void {
        const svc = chart.dependencies.find(c => c.name === this.service)
        if (!svc) {
            const msg = `Service ${this.service} not found in chart dependencies`
            throw new Error(msg)
        }
        const oldVersion = svc.version
        if (oldVersion === this.version) {
            core.info(
                `version ${this.version} is the same as the current version`
            )
            return
        }
        svc.version = this.version
    }

    async commitChange(content: string): Promise<void> {
        // create blob
        core.debug('creating blob')
        let url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs`
        core.debug(url)
        let body: any = {
            content,
            encoding: 'utf-8'
        }
        let res = await post({
            url,
            headers: this.headers,
            body,
            json: true
        })
        core.debug(res)
        const blobSha = res.sha

        // create a tree
        core.debug('creating tree')
        url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees`
        body = {
            // eslint-disable-next-line @typescript-eslint/camelcase
            base_tree: this.baseTree,
            tree: [
                {
                    path: 'environment/Chart.yaml',
                    mode: '100644',
                    type: 'blob',
                    sha: blobSha
                }
            ]
        }
        res = await post({url, headers: this.headers, body, json: true})
        core.debug('created tree')
        core.debug(res)
        const treeSha = res.sha

        // create commit
        core.debug('creating commit')
        url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/commits`
        body = {
            message: `Release service ${this.service} version ${this.version}`,
            author: {
                name: this.authorName,
                email: this.authorEmail,
                date: new Date().toISOString()
            },
            parents: [this.parentCommit],
            tree: treeSha
        }
        res = await post({url, headers: this.headers, body, json: true})
        core.debug('created commit')
        core.debug(res)

        // update ref
        core.debug('Updating ref')
        url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`
        body = {
            sha: res.sha,
            force: false
        }
        res = await patch({
            url,
            headers: this.headers,
            body,
            json: true
        })
        core.debug('created ref')
        core.debug(res)
    }

    async release(): Promise<void> {
        let content = await this.getChartYaml()
        const chart = yaml.safeLoad(content)
        this.updateChart(chart)
        content = yaml.safeDump(chart)
        await this.commitChange(content)
    }
}
