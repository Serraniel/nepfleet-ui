// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	qt "github.com/mappu/miqt/qt6"
)

// MachinesPage lists the machines the daemon knows, and sets them up.
type MachinesPage struct {
	a       *App
	w       *qt.QWidget
	table   *qt.QTableWidget
	remotes []Remote
	buttons map[string]*qt.QPushButton
}

func newMachinesPage(a *App) *MachinesPage {
	p := &MachinesPage{a: a, w: qt.NewQWidget2(), buttons: map[string]*qt.QPushButton{}}
	lay := qt.NewQVBoxLayout2()

	intro := qt.NewQLabel3("Machines this computer reaches over SSH. Adding one only looks at it; " +
		"nothing changes there until you set it up.")
	intro.SetWordWrap(true)
	lay.AddWidget(intro.QWidget)

	p.table = qt.NewQTableWidget3(0, 4)
	p.table.SetHorizontalHeaderLabels([]string{"Name", "Address", "State", "Connection"})
	p.table.SetSelectionBehavior(qt.QAbstractItemView__SelectRows)
	p.table.SetSelectionMode(qt.QAbstractItemView__SingleSelection)
	p.table.SetEditTriggers(qt.QAbstractItemView__NoEditTriggers)
	p.table.HorizontalHeader().SetStretchLastSection(true)
	p.table.VerticalHeader().Hide()
	p.table.OnItemSelectionChanged(p.updateButtons)
	lay.AddWidget(p.table.QWidget)

	row := qt.NewQHBoxLayout2()
	for _, b := range []struct{ key, text string }{
		{"add", "Add…"}, {"refresh", "Check again"}, {"setup", "Set up…"}, {"unlock", "Unlock key…"},
		{"connect", "Connect"}, {"disconnect", "Disconnect"}, {"remove", "Remove"},
	} {
		btn := qt.NewQPushButton3(b.text)
		p.buttons[b.key] = btn
		row.AddWidget(btn.QWidget)
	}
	row.AddStretch()
	lay.AddLayout(row.QLayout)
	p.w.SetLayout(lay.QLayout)

	p.buttons["add"].OnClicked(p.add)
	p.buttons["refresh"].OnClicked(func() { p.act("refresh") })
	p.buttons["connect"].OnClicked(func() { p.act("connect") })
	p.buttons["disconnect"].OnClicked(func() { p.act("disconnect") })
	p.buttons["remove"].OnClicked(p.remove)
	p.buttons["setup"].OnClicked(func() {
		if r, ok := p.selected(); ok {
			newSetupDialog(p, r).run()
		}
	})
	p.buttons["unlock"].OnClicked(func() {
		if r, ok := p.selected(); ok {
			p.unlock(r.LockedKeys, p.Refresh)
		}
	})
	p.updateButtons()
	return p
}

func (p *MachinesPage) selected() (Remote, bool) {
	i := p.table.CurrentRow()
	if i < 0 || i >= len(p.remotes) || len(p.table.SelectedItems()) == 0 {
		return Remote{}, false
	}
	return p.remotes[i], true
}

func (p *MachinesPage) updateButtons() {
	r, ok := p.selected()
	p.buttons["refresh"].SetEnabled(ok)
	p.buttons["remove"].SetEnabled(ok)
	p.buttons["setup"].SetEnabled(ok && r.SetupKind() != "")
	p.buttons["unlock"].SetEnabled(ok && len(r.LockedKeys) > 0)
	p.buttons["connect"].SetEnabled(ok && !r.Connect && r.CanConnect())
	p.buttons["disconnect"].SetEnabled(ok && r.Connect)
	switch {
	case ok && r.SetupKind() == "bootstrap":
		p.buttons["setup"].SetText("Prepare this machine…")
	case ok && r.SetupKind() == "install":
		p.buttons["setup"].SetText("Install NepFleet…")
	default:
		p.buttons["setup"].SetText("Set up…")
	}
}

// Refresh reloads the list from the daemon.
func (p *MachinesPage) Refresh() {
	var rs []Remote
	bg(func(ctx context.Context) (err error) { rs, err = p.a.d.Remotes(ctx); return err }, func(err error) {
		if err != nil {
			p.a.status.SetText("Listing machines: " + err.Error())
			return
		}
		keep := p.table.CurrentRow()
		p.remotes = rs
		p.table.SetRowCount(len(rs))
		for i, r := range rs {
			state := r.Next
			if r.Error != "" {
				state = "Last check failed: " + r.Error
			}
			conn := "not connected"
			switch {
			case r.Tunnel == "up":
				conn = "connected"
			case r.Connect && r.TunnelError != "":
				conn = "connecting failed: " + r.TunnelError
			case r.Connect:
				conn = "connecting…"
			}
			for col, text := range []string{r.Name, r.Address, state, conn} {
				item := qt.NewQTableWidgetItem2(text)
				item.SetToolTip(text)
				p.table.SetItem(i, col, item)
			}
		}
		p.table.ResizeColumnsToContents()
		if keep >= 0 && keep < len(rs) {
			p.table.SelectRow(keep)
		}
		p.updateButtons()
	})
}

func (p *MachinesPage) add() {
	dlg := qt.NewQDialog(p.a.win.QWidget)
	dlg.SetWindowTitle("Add a machine")
	form := qt.NewQFormLayout2()
	help := qt.NewQLabel3("Its SSH address, for example ssh://me@nas.local or ssh://me@203.0.113.10. " +
		"NepFleet uses your SSH keys, never a password. Connect once with ssh first, so its host key is known.")
	help.SetWordWrap(true)
	form.AddRowWithWidget(help.QWidget)
	address := qt.NewQLineEdit2()
	address.SetPlaceholderText("ssh://me@nas.local")
	name := qt.NewQLineEdit2()
	name.SetPlaceholderText("derived from the address")
	form.AddRow3("Address", address.QWidget)
	form.AddRow3("Name (optional)", name.QWidget)
	box := qt.NewQDialogButtonBox2()
	box.SetStandardButtons(qt.QDialogButtonBox__Ok | qt.QDialogButtonBox__Cancel)
	box.Button(qt.QDialogButtonBox__Ok).SetText("Add")
	box.OnAccepted(dlg.Accept)
	box.OnRejected(dlg.Reject)
	form.AddRowWithWidget(box.QWidget)
	dlg.SetLayout(form.QLayout)
	if dlg.Exec() != int(qt.QDialog__Accepted) {
		return
	}
	addr, n := strings.TrimSpace(address.Text()), strings.TrimSpace(name.Text())
	var do func()
	do = func() {
		p.a.status.SetText("Looking at " + addr + "…")
		bg(func(ctx context.Context) error { return p.a.d.AddRemote(ctx, addr, n) }, func(err error) {
			if keys := lockedKeys(err); len(keys) > 0 {
				p.unlock(keys, do)
				return
			}
			if err != nil {
				p.a.status.SetText("")
				p.a.errorBox("Adding the machine", err)
				return
			}
			p.a.status.SetText("Added " + addr)
			p.Refresh()
		})
	}
	do()
}

func (p *MachinesPage) act(action string) {
	r, ok := p.selected()
	if !ok {
		return
	}
	bg(func(ctx context.Context) error { return p.a.d.Action(ctx, r.Name, action) }, func(err error) {
		if keys := lockedKeys(err); len(keys) > 0 {
			p.unlock(keys, func() { p.act(action) })
			return
		}
		if err != nil {
			p.a.errorBox(r.Name, err)
		}
		p.Refresh()
	})
}

func (p *MachinesPage) remove() {
	r, ok := p.selected()
	if !ok {
		return
	}
	if qt.QMessageBox_Question(p.a.win.QWidget, "Remove "+r.Name+"?",
		"This computer forgets "+r.Address+". Nothing changes on the machine.") != qt.QMessageBox__Yes {
		return
	}
	bg(func(ctx context.Context) error { return p.a.d.RemoveRemote(ctx, r.Name) }, func(err error) {
		if err != nil {
			p.a.errorBox(r.Name, err)
		}
		p.Refresh()
	})
}

// unlock asks for each key's passphrase, unlocks it into the daemon's agent,
// then runs retry.
func (p *MachinesPage) unlock(keys []string, retry func()) {
	if len(keys) == 0 {
		retry()
		return
	}
	key := keys[0]
	label := key + " has a passphrase.\nNepFleet's SSH runs in the background without a terminal, " +
		"so it keeps the key unlocked in an SSH agent for 8 hours.\n\nPassphrase:"
	pass := qt.QInputDialog_GetText2(p.a.win.QWidget, "Unlock your SSH key", label, qt.QLineEdit__Password)
	if pass == "" {
		return
	}
	bg(func(ctx context.Context) error { return p.a.d.UnlockKey(ctx, key, pass) }, func(err error) {
		var api *APIError
		if errors.As(err, &api) && api.Status == 403 {
			qt.QMessageBox_Warning(p.a.win.QWidget, "Unlock your SSH key", "That passphrase doesn't unlock the key; try again.")
			p.unlock(keys, retry)
			return
		}
		if err != nil {
			p.a.errorBox("Unlocking the key", err)
			return
		}
		p.unlock(keys[1:], retry)
	})
}

// SetupDialog shows a setup plan, runs it, and follows its log.
type SetupDialog struct {
	p        *MachinesPage
	r        Remote
	dlg      *qt.QDialog
	title    *qt.QLabel
	steps    *qt.QListWidget
	problem  *qt.QLabel
	password *qt.QLineEdit
	passRow  *qt.QWidget
	log      *qt.QPlainTextEdit
	run_     *qt.QPushButton
	plan     SetupPlan
	timer    *qt.QTimer
}

func newSetupDialog(p *MachinesPage, r Remote) *SetupDialog {
	s := &SetupDialog{p: p, r: r, dlg: qt.NewQDialog(p.a.win.QWidget)}
	s.dlg.SetWindowTitle("Set up " + r.Name)
	s.dlg.Resize(640, 520)
	lay := qt.NewQVBoxLayout2()
	s.title = qt.NewQLabel3("Looking at the machine…")
	s.title.SetWordWrap(true)
	lay.AddWidget(s.title.QWidget)
	s.steps = qt.NewQListWidget2()
	lay.AddWidget(s.steps.QWidget)
	s.problem = qt.NewQLabel2()
	s.problem.SetWordWrap(true)
	s.problem.Hide()
	lay.AddWidget(s.problem.QWidget)

	s.passRow = qt.NewQWidget2()
	pl := qt.NewQFormLayout2()
	s.password = qt.NewQLineEdit2()
	s.password.SetEchoMode(qt.QLineEdit__Password)
	pl.AddRow3("Sudo password", s.password.QWidget)
	hint := qt.NewQLabel3("For the steps marked as root, this run only. It goes over SSH to sudo on the machine, and is kept nowhere.")
	hint.SetWordWrap(true)
	pl.AddRowWithWidget(hint.QWidget)
	s.passRow.SetLayout(pl.QLayout)
	s.passRow.Hide()
	lay.AddWidget(s.passRow)

	s.log = qt.NewQPlainTextEdit2()
	s.log.SetReadOnly(true)
	s.log.Hide()
	lay.AddWidget(s.log.QWidget)

	buttons := qt.NewQHBoxLayout2()
	buttons.AddStretch()
	closeBtn := qt.NewQPushButton3("Close")
	closeBtn.OnClicked(func() { s.dlg.Reject() })
	s.run_ = qt.NewQPushButton3("Run this plan")
	s.run_.SetEnabled(false)
	s.run_.SetDefault(true)
	s.run_.OnClicked(s.start)
	buttons.AddWidget(closeBtn.QWidget)
	buttons.AddWidget(s.run_.QWidget)
	lay.AddLayout(buttons.QLayout)
	s.dlg.SetLayout(lay.QLayout)
	s.password.OnTextChanged(func(string) { s.updateRun() })
	return s
}

func (s *SetupDialog) run() {
	s.loadPlan(s.r.SetupKind())
	s.dlg.Exec()
	if s.timer != nil {
		s.timer.Stop()
	}
	s.password.SetText("")
	s.p.Refresh()
}

func (s *SetupDialog) updateRun() {
	ok := s.plan.ID != "" && (!s.plan.SudoPassword || s.password.Text() != "")
	s.run_.SetEnabled(ok)
}

func (s *SetupDialog) loadPlan(kind string) {
	s.steps.Clear()
	s.problem.Hide()
	s.passRow.Hide()
	s.run_.SetEnabled(false)
	s.title.SetText("Looking at the machine…")
	var plan SetupPlan
	bg(func(ctx context.Context) (err error) { plan, err = s.p.a.d.SetupPlan(ctx, s.r.Name, kind); return err }, func(err error) {
		if keys := lockedKeys(err); len(keys) > 0 {
			s.p.unlock(keys, func() { s.loadPlan(kind) })
			return
		}
		if err != nil {
			s.title.SetText("Couldn't plan it: " + err.Error())
			return
		}
		s.plan = plan
		what := "Prepare the machine"
		if plan.Kind == "install" {
			what = "Install NepFleet"
		}
		if plan.Error != "" {
			s.title.SetText(what + " on " + s.r.Name + ": it would need:")
			s.problem.SetText(plan.Error)
			s.problem.Show()
		} else {
			s.title.SetText(what + " on " + s.r.Name + ". This runs on the machine, in order:")
		}
		for i, st := range plan.Steps {
			text := fmt.Sprintf("%d. %s", i+1, st.Text)
			if st.Root {
				text += "   (as root)"
			}
			s.steps.AddItem(text)
		}
		if plan.SudoPassword && plan.ID != "" {
			s.passRow.Show()
			s.password.SetFocus()
		}
		s.run_.SetText("Run this plan")
		s.updateRun()
	})
}

func (s *SetupDialog) start() {
	pass := ""
	if s.plan.SudoPassword {
		pass = s.password.Text()
	}
	s.password.SetText("")
	s.passRow.Hide()
	s.run_.SetEnabled(false)
	s.log.Show()
	s.log.SetPlainText("Starting…")
	plan := s.plan
	bg(func(ctx context.Context) error { return s.p.a.d.StartSetup(ctx, s.r.Name, plan, pass) }, func(err error) {
		if err != nil {
			s.log.SetPlainText("Couldn't start: " + err.Error())
			s.updateRun()
			return
		}
		s.follow()
	})
}

// follow polls the job until it ends.
func (s *SetupDialog) follow() {
	s.timer = qt.NewQTimer2(s.dlg.QObject)
	s.timer.SetInterval(2000)
	busy := false
	s.timer.OnTimeout(func() {
		if busy {
			return
		}
		busy = true
		var job SetupJob
		bg(func(ctx context.Context) (err error) { job, err = s.p.a.d.SetupJob(ctx, s.r.Name); return err }, func(err error) {
			busy = false
			if err != nil {
				return
			}
			s.log.SetPlainText(job.Log)
			if job.State == "running" {
				return
			}
			s.timer.Stop()
			if job.State == "failed" {
				s.log.AppendPlainText("\nFailed: " + job.Error)
				s.updateRun()
				return
			}
			s.log.AppendPlainText("\nDone.")
			if s.plan.Kind == "bootstrap" {
				// Installing NepFleet is next.
				s.loadPlan("install")
				return
			}
			s.title.SetText("NepFleet runs on " + s.r.Name + ". Back up its age key: without it, no secret of that fleet can be read. " +
				"Then connect, to manage its stacks from here.")
			s.run_.SetText("Done")
		})
	})
	s.timer.Start2()
}
