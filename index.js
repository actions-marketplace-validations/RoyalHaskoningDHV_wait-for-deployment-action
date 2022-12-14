const core = require('@actions/core')
const github = require('@actions/github')

const options = {
  token: core.getInput('github-token'),
  environment: core.getInput('environment'),
  sha: core.getInput('sha'),
  timeout: core.getInput('timeout'),
  interval: core.getInput('interval')
}

waitForDeployment(options)
  .then(res => {
    core.setOutput('id', res.deployment.id)
    core.setOutput('url', res.url)
  })
  .catch(error => {
    core.setFailed(error.message)
  })

async function waitForDeployment (options) {
  const {
    token,
    environment,
    sha
  } = options

  const interval = options.interval ? parseInt(options.interval) : 5
  const timeout = options.timeout ? parseInt(options.timeout) : 30

  const octokit = github.getOctokit(token)
  const start = Date.now()

  const params = {
    ...github.context.repo,
    environment,
    sha
  }

  core.info(`Deployment params: ${JSON.stringify(params, null, 2)}`)
  // throw new Error('DERP')

  while (true) {
    const { data: deployments } = await octokit.repos.listDeployments(params)
    core.info(`Found ${deployments.length} deployments...`)

    for (const deployment of deployments) {
      core.info(`\tgetting statuses for deployment ${deployment.id}...`)

      // note: sometimes the github API will throw a not found error when the deployment statuses are requested
      // immediately after listing the deployments, which is why we wrap this call in a try/catch and retry if it fails
      try {
        const { data: statuses } = await octokit.request('GET /repos/:owner/:repo/deployments/:deployment/statuses', {
          ...github.context.repo,
          deployment: deployment.id
        })

        core.info(`\tfound ${statuses.length} statuses`)

        const [success] = statuses
          .filter(status => status.state === 'success')
        if (success) {
          core.info(`\tsuccess! ${JSON.stringify(success, null, 2)}`)
          let url = success.target_url
          const { payload = {} } = deployment
          if (payload.web_url) {
            url = payload.web_url
          }
          return {
            deployment,
            status: success,
            url
          }
        } else {
          core.info(`No statuses with state === "success": "${statuses.map(status => status.state).join('", "')}"`)
        }
      } catch (error) {
        // don't do anything, we retry in the next iteration
      }
    }

    await sleep(interval)

    const elapsed = (Date.now() - start) / 1000
    if (elapsed >= timeout) {
      throw new Error(`Timing out after ${timeout} seconds (${elapsed} elapsed)`)
    }
  }
}

function sleep (seconds) {
  const ms = seconds * 1000
  return new Promise(resolve => setTimeout(resolve, ms))
}
