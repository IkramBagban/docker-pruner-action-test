const core = require("@actions/core");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function runSSHCommand(command, keyPath, username, host) {
  if (!username.match(/^[a-zA-Z0-9_-]+$/) || !host.match(/^[a-zA-Z0-9.-]+$/)) {
    throw new Error("Invalid username or host");
  }
  // Write command to a temporary script file to avoid quoting issues
  const scriptPath = path.join(os.tmpdir(), "cleanup.sh");
  fs.writeFileSync(scriptPath, `#!/bin/bash\n${command}`, { mode: 0o700 });
  return `ssh -i ${keyPath} -o StrictHostKeyChecking=no ${username}@${host} "bash < ${scriptPath}"`;
}

(async () => {
  try {
    const host = core.getInput("host", { required: true });
    const username = core.getInput("username", { required: true });
    const key = core.getInput("key", { required: true });
    const thresholdDaysInput = core.getInput("thresholdDays");
    const thresholdDays = thresholdDaysInput
      ? parseInt(thresholdDaysInput)
      : null;

    if (
      thresholdDays !== null &&
      (isNaN(thresholdDays) || thresholdDays <= 0)
    ) {
      throw new Error("thresholdDays must be a positive integer");
    }

    const keyPath = path.join(os.tmpdir(), "vm_key.pem");
    fs.writeFileSync(keyPath, key + "\n", { mode: 0o600 });

    try {
      const commands = [];
      commands.push('docker image prune -f --filter "dangling=true"');

      const thresholdSeconds = thresholdDays
        ? thresholdDays * 60
        : null;

      if (thresholdSeconds) {
        commands.push(
          `
          docker ps -a --format '{{.ID}} {{.CreatedAt}}' | while read id createdAt; do
            createdSec=$(date -d "$createdAt" +%s 2>/dev/null || date -j -f "%Y-%m-%d %H:%M:%S %z" "$createdAt" +%s)
            now=$(date +%s)
            age=$((now - createdSec))
            status=$(docker inspect --format="{{.State.Status}}" $id)
            if [ "$age" -gt ${thresholdSeconds} ] && [ "$status" = "exited" ]; then
              echo "Removing stopped container $id (older than ${thresholdDays} days)"
              docker rm -f $id || true
            fi
          done
        `
            .replace(/\s+/g, " ")
            .trim()
        );

        commands.push(
          `
          docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' | while read id repo; do
            created=$(docker inspect --format="{{.Created}}" $id | cut -d. -f1)
            createdSec=$(date -d "$created" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$created" +%s)
            now=$(date +%s)
            age=$((now - createdSec))
            inUse=$(docker ps -a --filter "ancestor=$id" --format '{{.ID}}' | wc -l | tr -d ' ')
            if [ "$age" -gt ${thresholdSeconds} ] && [ "$inUse" -eq 0 ]; then
              echo "Removing unused image: $repo (older than ${thresholdDays} days)"
              docker rmi -f $id || true
            fi
          done
        `
            .replace(/\s+/g, " ")
            .trim()
        );
      } else {
        commands.push("docker container prune -f");
        commands.push("docker image prune -a -f");
      }

      const finalCommand = commands.join(" && ");
      core.info(`Generated Command:\n${finalCommand}`);

      const sshCommand = runSSHCommand(finalCommand, keyPath, username, host);
      core.info(`Executing Cleanup:\n${sshCommand}`);

      exec(sshCommand, (error, stdout, stderr) => {
        if (error) {
          core.setFailed(`SSH Command Failed: ${error.message}`);
          return;
        }
        core.info(`STDOUT:\n${stdout}`);
        if (stderr) core.error(`STDERR:\n${stderr}`);
      });
    } finally {
      fs.unlinkSync(keyPath);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
})();
