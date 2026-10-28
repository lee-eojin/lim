# Regenerate docs/demo/review-loop.gif from the repository root:
#   vhs docs/demo/review-loop.tape

Output docs/demo/review-loop.gif

Require node
Require git

Set Shell bash
Set FontSize 16
Set Width 1020
Set Height 640
Set Padding 16
Set Theme "Dracula"
Set Framerate 10
Set TypingSpeed 40ms

Hide
Type "export PS1='$ ' DEMO_PAUSE=3 DEMO_PROMPT_PAUSE=0.6 && clear"
Enter
Show

Type "docs/demo/review-loop.sh"
Sleep 500ms
Enter
Sleep 34s
