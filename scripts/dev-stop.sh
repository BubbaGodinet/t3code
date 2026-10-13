#!/usr/bin/env bash
# Stop the local Argus / T3 Code dev stack so the next start owns the ports.
set -u

script_dir="$(cd "$(dirname "$0")" && pwd)"
t3_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$t3_root/../.." && pwd)"

matches_stack() {
  local command="$1"
  case "$command" in
    *dev-stop.sh*) return 1 ;;
  esac
  case "$command" in
    *"$t3_root"*)
      case "$command" in
        *dev-runner.ts*|*"vp run"*|*vite-plus*|*dist/bin.mjs*|*dist-electron/main.cjs*|*--t3code-dev-root=*)
          return 0
          ;;
      esac
      ;;
    *"$repo_root/apps/argus"*)
      case "$command" in
        *"next dev"*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

pids=()
seen=" "
add_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  case "$seen" in
    *" $pid "*) return 0 ;;
  esac
  seen+="$pid "
  pids+=("$pid")
}

while IFS= read -r line; do
  pid="${line%% *}"
  command="${line#"$pid" }"
  command="${command#"${command%%[![:space:]]*}"}"
  if matches_stack "$command"; then
    add_pid "$pid"
  fi
done < <(ps -ax -o pid=,command=)

# `node src/bin.ts` does not mention the repo, but its working directory does.
cwd_pid=""
while IFS= read -r line; do
  case "$line" in
    p*) cwd_pid="${line#p}" ;;
    n*)
      case "${line#n}" in
        "$t3_root"|"$t3_root"/*|"$repo_root/apps/argus"|"$repo_root/apps/argus"/*)
          add_pid "$cwd_pid"
          ;;
      esac
      ;;
  esac
done < <(lsof -nP -d cwd -a -c node -Fn 2>/dev/null || true)

if [[ ${#pids[@]} -eq 0 ]]; then
  echo "Nothing from this Argus / T3 Code dev stack is running."
  exit 0
fi

echo "Stopping ${#pids[@]} Argus / T3 Code dev process(es)."
kill "${pids[@]}" 2>/dev/null || true
sleep 0.6

still=()
for pid in "${pids[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    still+=("$pid")
  fi
done
if [[ ${#still[@]} -gt 0 ]]; then
  kill -9 "${still[@]}" 2>/dev/null || true
fi

echo "Stopped. Ports 3100, 5733, and 13773 are free for the next start."
echo "Start the window with: cd apps/t3code && vp run dev:desktop"
