import * as core from '@actions/core'
import {Committer} from './rel'

async function run(): Promise<void> {
    try {
        const owner: string = core.getInput('owner')
        core.debug(`owner: ${owner}`)
        const repo: string = core.getInput('repo')
        core.debug(`repo: ${repo}`)
        const environment: string = core.getInput('environment')
        core.debug(`environment: ${environment}`)
        const service: string = core.getInput('service')
        core.debug(`service: ${service}`)
        const version: string = core.getInput('version')
        core.debug(`version: ${version}`)
        const token: string = core.getInput('token')
        core.debug(`version: ${token}`)

        await new Committer(
            owner,
            repo,
            environment,
            service,
            version,
            token
        ).release()
        core.info('committed to environment repo successfully.')
    } catch (error) {
        core.setFailed(error.message)
    }
}

run()
