Wait only when blocked with nothing else to do.
Blocks on background jobs/services you started; returns on the first result (jobs settling together come back in one result), a direct message to you, or a steering interrupt; a safety cap returns a still-running snapshot. Broadcasts never end a wait; they arrive after it returns.
Result in, other jobs still running? SHOULD act on it before waiting again.
Nothing you started running? Errors; NEVER wait on agents you didn't start (deadlock risk).
Results and messages auto-deliver. NEVER poll while work remains.
