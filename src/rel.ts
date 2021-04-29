import got from 'got'
import yaml from 'js-yaml'
import core from '@actions/core'

interface Service {
    version: string
}

interface Services {
    [name: string]: Service
}

interface Values {
    services: Services
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

    async getYaml(yamlFileName: string): Promise<string> {
        // get ref
        let response = await got.get(
            `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`,
            {
                headers: this.headers,
                responseType: 'json'
            }
        )
        let res: any = response.body
        let {url} = res
        core.debug(url)

        // get commit
        response = await got.get(url, {
            headers: this.headers,
            responseType: 'json'
        })
        res = response.body
        core.debug(res.tree.url)
        url = res.tree.url
        this.baseTree = res.tree.sha
        this.parentCommit = res.sha

        // get tree
        response = await got.get(url, {
            headers: this.headers,
            responseType: 'json'
        })
        // find the file
        let file = res.tree.find((v: any) => v.path === 'environment')
        url = file.url
        core.debug(url)
        response = await got.get(url, {
            headers: this.headers,
            responseType: 'json'
        })
        res = response.body
        file = res.tree.find((v: any) => v.path === yamlFileName)
        url = file.url
        core.debug(url)
        response = await got.get(url, {
            headers: this.headers,
            responseType: 'json'
        })
        res = response.body
        return Buffer.from(res.content, 'base64').toString('utf-8')
    }

    updateVersion(values: Values): void {
        const svc = values.services[this.service]
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
        let response = await got.post(url, {
            headers: this.headers,
            body,
            responseType: 'json'
        })
        let res: any = response.body
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
                    path: 'environment/values.yaml',
                    mode: '100644',
                    type: 'blob',
                    sha: blobSha
                }
            ]
        }
        response = await got.post(url, {
            headers: this.headers,
            body,
            responseType: 'json'
        })
        res = response.body
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
        response = await got.post(url, {
            headers: this.headers,
            body,
            responseType: 'json'
        })
        res = response.body
        core.debug('created commit')
        core.debug(res)

        // update ref
        core.debug('Updating ref')
        url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`
        body = {
            sha: res.sha,
            force: false
        }
        response = await got.patch(url, {
            headers: this.headers,
            body,
            responseType: 'json'
        })
        res = response.body
        core.debug('created ref')
        core.debug(res)
    }

    async release(): Promise<void> {
        let content = await this.getYaml('values.yaml')
        const values = yaml.safeLoad(content)
        this.updateVersion(values as Values)
        content = yaml.safeDump(values)
        await this.commitChange(content)
    }
}
