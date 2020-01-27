const rp = require('request-promise');
const yaml = require('js-yaml');
let baseTree;
let parentCommit;

const headers = { 
    authorization: `token 34ddc57bfc23f4d926007e448de17b242d8c54a7`,
    accept: 'application/vnd.github.v3+json',
    'User-Agent': 'release action' 
};

async function getChartYaml(branch) {
    // get ref
    let res = await rp({
        uri: `https://api.github.com/repos/modustech/environments/git/refs/heads/${branch}`,
        headers,
        json: true
    });
    let { url } = res.object;
    console.log(url);

    // get commit
    res = await rp({url, headers, json: true});
    console.log(res.tree.url);
    url = res.tree.url;
    baseTree = res.tree.sha;
    parentCommit = res.sha;

    // get tree
    res = await rp({url, headers, json: true});
    // find the file
    let file = res.tree.find(v => v.path === 'environment');
    url = file.url;
    console.log(url)
    res = await rp({url, headers, json: true});
    file = res.tree.find(v => v.path === 'Chart.yaml');
    url = file.url;
    console.log(url)
    res = await rp({url, headers, json: true});
    const content = Buffer.from(res.content, 'base64').toString('utf-8');
    // console.log(content);
    return content;
}

async function updateChart(chart, service, version) {
    const svc = chart.dependencies.find(c => c.name === service);
    if (!svc) {
        const msg = `Service ${service} not found in chart dependencies`;
        console.error(msg);
        throw new Error(msg);
    }
    const oldVersion = svc.version;
    if (oldVersion == version) {
        console.log(`version ${version} is the same as the current version`);
        return;
    }
    svc.version = version;
}

async function commitChange(branch, content, service, version) {
    // create blob
    const method = 'POST';
    console.log('creating blob')
    let url = `https://api.github.com/repos/modustech/environments/git/blobs`;
    console.log(url)
    let body = {
        content,
        encoding: 'utf-8'
    };
    let res = await rp({ url, method, headers, body, json: true });
    console.log(res)
    const blobSha = res.sha;

    // create a tree
    console.log('creating tree')
    url = `https://api.github.com/repos/modustech/environments/git/trees`;
    body = {
        base_tree: baseTree,
        tree: [{
            path: 'environment/Chart.yaml',
            mode: '100644',
            type: 'blob',
            sha: blobSha
        }]
    };
    res = await rp({ url, method, headers, body, json: true });
    console.log('created tree', res)
    const treeSha = res.sha;

    // create commit
    console.log('creating commit')
    url = `https://api.github.com/repos/modustech/environments/git/commits`;
    body = {
        message: `Release service ${service} version ${version}`,
        author: { name: 'Modus CI', email: 'dev@modusclosing.com', date: new Date().toISOString() },
        parents: [parentCommit],
        tree: treeSha
    };
    res = await rp({ url, method, headers, body, json: true });
    console.log('created commit', res)

    // update ref
    console.log('Updating ref')
    url = `https://api.github.com/repos/modustech/environments/git/refs/heads/${branch}`;
    body = {
        sha: res.sha,
        force: false
    };
    res = await rp({ url, method: 'PATCH', headers, body, json: true });
    console.log('created ref', res)

}

async function release(environment, service, version) {
    let content = await getChartYaml(environment);
    const chart = yaml.safeLoad(content)
    await updateChart(chart, service, version);
    content = yaml.safeDump(chart);
    await commitChange(environment, content, service, version);
}

async function run() {
    const args = process.argv;
    if (args.length != 5) {
        console.error('invalid arguments')
        console.error('release <environment> <service> <version>');
        process.exit(1);
    }

    try {
        const env = args[2];
        const svc = args[3];
        const ver = args[4];
        console.log(`environment: ${env}, service: ${svc}, version: ${ver}`);

        await release(env, svc, ver);
        console.log('committed to environment repo successfully.'); 
    } catch (err) {
        console.error('failed to commit to environment repo.', err); 
    }
}
run();
