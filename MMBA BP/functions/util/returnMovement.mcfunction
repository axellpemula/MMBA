inputpermission set @s movement enabled
inputpermission set @s camera enabled
inputpermission set @s movement enabled
inputpermission set @s move_forward enabled
inputpermission set @s jump enabled
inputpermission set @s sneak enabled
hud @s reset
event entity @s xvoid:jatuh
scoreboard players set @s[scores={sp1=..-1}] sp1 20
camera @s clear

effect @s slowness 0