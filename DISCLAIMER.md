# Use at your own risk

Carve is software that clicks, types and reads on your Mac, in the window you point it at, on the
instructions of a language model. Please read this before you run it.

**It is provided as is.** There is no warranty of any kind, and the authors and Carvify, Inc. accept no
liability for what happens when you run it, to the fullest extent the law allows. The full terms are in
the [license](LICENSE), sections 15 and 16. If you sign in to Carve's hosted plan, its
[Terms of Use](legal/documents.json) apply to that plan as well.

**Models make mistakes.** Carve limits the model to one window, checks each action against rules in
plain code, and stops to ask before actions it classifies as consequential. Those rules are a safety
net, not a guarantee. The model can misread a page, pick the wrong control, or finish a task in a way
you did not intend, and the classifier can miss an action that mattered.

**Some actions cannot be undone.** A sent message, a submitted form, a deleted file or a purchase does
not come back. Watch Carve in windows where a wrong click costs something, and keep the stop key
(<kbd>Esc</kbd> or <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd>) in mind.

**You choose what it sees.** With your own model key, images of the window you select and the text
around your request go to the provider you configured, under that provider's terms. Nothing goes
anywhere until you grant Screen Recording and agree to share the window. Do not point Carve at
windows containing things you would not send to that provider.

**You are responsible for how it is used.** Use Carve only on accounts, sites and apps you are
permitted to automate, and in line with their terms. Some services prohibit automated use.

**It is early software.** Versions are tagged and the [security model](docs/security-model.md) says what
is enforced in code and what is a model's judgment. Expect bugs. Report security issues as described in
[SECURITY.md](SECURITY.md).
