#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# npm audit of the dependencies that ship (no dev), failing on high and
# critical advisories unless .github/audit-allowlist accepts them until a date.
# Needs npm and jq.
set -eu
cd "$(dirname "$0")/.."
allow=.github/audit-allowlist
today=$(date -u +%Y-%m-%d)

# Accepted advisories whose date hasn't passed; expired ones fail by name.
accepted=""
expired=0
while read -r id until _; do
	case "$id" in GHSA-*) ;; *) continue ;; esac
	if [ "$until" \< "$today" ]; then
		echo "::error::$allow: $id was accepted until $until; look at it again (fixed release? still not shipped?) and update or remove it"
		expired=1
	else
		accepted="$accepted $id"
	fi
done <"$allow"

report=$(npm audit --omit=dev --json 2>/dev/null || true)
found=$(printf '%s' "$report" | jq -r '
	[.vulnerabilities[]?.via[]? | objects
		| select(.severity == "high" or .severity == "critical")
		| "\(.url | split("/") | last) \(.severity) \(.name): \(.title)"] | unique | .[]')

failed=$expired
if [ -n "$found" ]; then
	printf '%s\n' "$found" | while read -r id rest; do
		case " $accepted " in
		*" $id "*) echo "accepted: $id $rest" ;;
		*) echo "::error::$id $rest" ;;
		esac
	done
	for id in $(printf '%s\n' "$found" | cut -d' ' -f1); do
		case " $accepted " in *" $id "*) ;; *) failed=1 ;; esac
	done
fi
if [ "$failed" = 1 ]; then
	echo "npm audit: high or critical advisories that .github/audit-allowlist doesn't accept"
	exit 1
fi
echo "npm audit: nothing high or critical beyond what the allowlist accepts"
