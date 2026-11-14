// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// The app is a client of the local control daemon (`nepfleet control`), as the
// web UI is: all logic lives there. It talks over the daemon's owner-only Unix
// socket, which needs no token.

// controlDir is where the daemon keeps its socket, as nepfleet decides it.
func controlDir() string {
	if d := os.Getenv("NEPFLEET_CONTROL_DIR"); d != "" {
		return d
	}
	state := os.Getenv("XDG_STATE_HOME")
	if state == "" {
		home, _ := os.UserHomeDir()
		state = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(state, "nepfleet", "control")
}

// Daemon is a client of the control daemon.
type Daemon struct {
	sock string
	http *http.Client
}

func newDaemon() *Daemon {
	sock := filepath.Join(controlDir(), "control.sock")
	return &Daemon{sock: sock, http: &http.Client{
		Timeout: 3 * time.Minute,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", sock)
		}},
	}}
}

// APIError is an error answer of the daemon.
type APIError struct {
	Status     int
	Message    string
	LockedKeys []string
}

func (e *APIError) Error() string { return e.Message }

// lockedKeys are the keys an error says need unlocking first.
func lockedKeys(err error) []string {
	var e *APIError
	if errors.As(err, &e) {
		return e.LockedKeys
	}
	return nil
}

func (d *Daemon) call(ctx context.Context, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://control"+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := d.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		var e struct {
			Error      string   `json:"error"`
			LockedKeys []string `json:"lockedKeys"`
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if json.Unmarshal(raw, &e) != nil || e.Error == "" {
			e.Error = fmt.Sprintf("%s (HTTP %d)", bytes.TrimSpace(raw), res.StatusCode)
		}
		return &APIError{Status: res.StatusCode, Message: e.Error, LockedKeys: e.LockedKeys}
	}
	if out == nil || res.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// Ensure starts the daemon unless it answers. It keeps running after the app
// quits, with its tunnels, as `nepfleet control` does from the CLI.
func (d *Daemon) Ensure(ctx context.Context) error {
	if d.call(ctx, http.MethodGet, "/v1/info", nil, nil) == nil {
		return nil
	}
	exe, err := exec.LookPath("nepfleet")
	if err != nil {
		// Installers ship it next to the app.
		if self, serr := os.Executable(); serr == nil {
			if p := filepath.Join(filepath.Dir(self), "nepfleet"); fileExists(p) {
				exe, err = p, nil
			}
		}
	}
	if err != nil {
		return errors.New("the nepfleet command was not found: install NepFleet first")
	}
	if err := os.MkdirAll(controlDir(), 0o700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(controlDir(), "control.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = logFile.Close() }()
	cmd := exec.Command(exe, "control") //nolint:gosec,noctx // nepfleet itself; it must outlive the app
	cmd.Stdout, cmd.Stderr = logFile, logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting the control daemon: %w", err)
	}
	_ = cmd.Process.Release()
	for range 50 {
		if d.call(ctx, http.MethodGet, "/v1/info", nil, nil) == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("the control daemon did not start; see %s", logFile.Name())
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// Report is what a probe found on a machine.
type Report struct {
	Kernel          string `json:"kernel"`
	OS              string `json:"os"`
	Arch            string `json:"arch"`
	User            string `json:"user"`
	Root            bool   `json:"root"`
	Sudo            bool   `json:"sudo"`
	SudoPassword    bool   `json:"sudoPassword"`
	Docker          bool   `json:"docker"`
	DockerRunning   bool   `json:"dockerRunning"`
	Compose         bool   `json:"compose"`
	NepFleetRunning bool   `json:"nepfleetRunning"`
	Fleet           string `json:"fleet"`
}

// Remote is a machine the daemon knows.
type Remote struct {
	Name        string   `json:"name"`
	Address     string   `json:"address"`
	Report      *Report  `json:"report"`
	Next        string   `json:"next"`
	Error       string   `json:"error"`
	LockedKeys  []string `json:"lockedKeys"`
	Connect     bool     `json:"connect"`
	Tunnel      string   `json:"tunnel"`
	TunnelError string   `json:"tunnelError"`
}

// SetupKind is what setting a machine up does next: prepare it, or install
// NepFleet; empty when there's nothing to set up.
func (r Remote) SetupKind() string {
	rep := r.Report
	if rep == nil || (rep.Kernel != "" && rep.Kernel != "Linux") || rep.NepFleetRunning || rep.Fleet != "" {
		return ""
	}
	if !rep.Docker || !rep.DockerRunning || !rep.Compose {
		return "bootstrap"
	}
	return "install"
}

// CanConnect: connecting talks to NepFleet on the machine.
func (r Remote) CanConnect() bool {
	return r.Report != nil && (r.Report.NepFleetRunning || r.Report.Fleet != "")
}

func (d *Daemon) Remotes(ctx context.Context) ([]Remote, error) {
	var rs []Remote
	return rs, d.call(ctx, http.MethodGet, "/v1/remotes", nil, &rs)
}

func (d *Daemon) AddRemote(ctx context.Context, address, name string) error {
	return d.call(ctx, http.MethodPost, "/v1/remotes", map[string]string{"address": address, "name": name}, nil)
}

// Action is refresh, connect or disconnect.
func (d *Daemon) Action(ctx context.Context, name, action string) error {
	return d.call(ctx, http.MethodPost, "/v1/remotes/"+url.PathEscape(name)+"/"+action, nil, nil)
}

func (d *Daemon) RemoveRemote(ctx context.Context, name string) error {
	return d.call(ctx, http.MethodDelete, "/v1/remotes/"+url.PathEscape(name), nil, nil)
}

// Step is one step of a setup plan.
type Step struct {
	Text string `json:"text"`
	Root bool   `json:"root"`
}

// SetupPlan is what a setup would do.
type SetupPlan struct {
	Kind         string `json:"kind"`
	Steps        []Step `json:"steps"`
	ID           string `json:"id"`
	Error        string `json:"error"`
	SudoPassword bool   `json:"sudoPassword"`
}

// SetupJob is a running or finished setup.
type SetupJob struct {
	State string `json:"state"`
	Log   string `json:"log"`
	Error string `json:"error"`
}

func (d *Daemon) SetupPlan(ctx context.Context, name, kind string) (SetupPlan, error) {
	var p SetupPlan
	return p, d.call(ctx, http.MethodGet, "/v1/remotes/"+url.PathEscape(name)+"/setup?kind="+url.QueryEscape(kind), nil, &p)
}

// StartSetup runs a reviewed plan; sudoPassword is for this run only.
func (d *Daemon) StartSetup(ctx context.Context, name string, p SetupPlan, sudoPassword string) error {
	body := map[string]string{"kind": p.Kind, "plan": p.ID}
	if sudoPassword != "" {
		body["sudoPassword"] = sudoPassword
	}
	return d.call(ctx, http.MethodPost, "/v1/remotes/"+url.PathEscape(name)+"/setup", body, nil)
}

func (d *Daemon) SetupJob(ctx context.Context, name string) (SetupJob, error) {
	var j SetupJob
	return j, d.call(ctx, http.MethodGet, "/v1/remotes/"+url.PathEscape(name)+"/setup/job", nil, &j)
}

// UnlockKey adds a key with a passphrase to the daemon's agent for 8 hours.
func (d *Daemon) UnlockKey(ctx context.Context, path, passphrase string) error {
	return d.call(ctx, http.MethodPost, "/v1/keys/unlock", map[string]string{"path": path, "passphrase": passphrase}, nil)
}

// Fleet API, through the daemon's proxy to a connected remote.

// Stack is one stack of a fleet.
type Stack struct {
	Name     string `json:"name"`
	Target   string `json:"target"`
	Mode     string `json:"mode"`
	Template string `json:"template"`
	State    string `json:"state"`
	Updates  string `json:"updates"`
}

// Change is one file or image a plan changes.
type Change struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
	Diff string `json:"diff"`
}

// PlanStep is one thing apply does.
type PlanStep struct {
	Text        string `json:"text"`
	Destructive bool   `json:"destructive"`
}

// Plan is what applying a stack would change.
type Plan struct {
	ID          string     `json:"id"`
	First       bool       `json:"first"`
	Changes     []Change   `json:"changes"`
	Destructive []string   `json:"destructive"`
	Steps       []PlanStep `json:"steps"`
}

// Job is an apply running on the fleet.
type Job struct {
	ID    string `json:"id"`
	State string `json:"state"`
	Log   string `json:"log"`
	Error string `json:"error"`
}

func fleetPath(remote, path string) string {
	return "/v1/remotes/" + url.PathEscape(remote) + "/api" + path
}

func (d *Daemon) Stacks(ctx context.Context, remote string) ([]Stack, error) {
	var s []Stack
	return s, d.call(ctx, http.MethodGet, fleetPath(remote, "/v1/stacks"), nil, &s)
}

func (d *Daemon) Plan(ctx context.Context, remote, stack string) (Plan, error) {
	var p Plan
	return p, d.call(ctx, http.MethodGet, fleetPath(remote, "/v1/stacks/"+url.PathEscape(stack)+"/plan"), nil, &p)
}

func (d *Daemon) Apply(ctx context.Context, remote, stack, planID string, confirm bool) (Job, error) {
	var j Job
	body := map[string]any{"plan": planID}
	if confirm {
		body["confirmDestructive"] = true
	}
	return j, d.call(ctx, http.MethodPost, fleetPath(remote, "/v1/stacks/"+url.PathEscape(stack)+"/apply"), body, &j)
}

func (d *Daemon) Job(ctx context.Context, remote, id string) (Job, error) {
	var j Job
	return j, d.call(ctx, http.MethodGet, fleetPath(remote, "/v1/jobs/"+url.PathEscape(id)), nil, &j)
}
