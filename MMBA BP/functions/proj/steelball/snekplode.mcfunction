execute as @s run scoreboard players set @s radpos 34
execute as @s run scoreboard players set @s radius 35
execute at @s run particle minecraft:knockback_roar_particle ~~~
execute as @s positioned ^^^ run scriptevent xvoid:damage
execute at @s as @e[r=2,type=!jjba:steelball] run scriptevent xvoid:up1
execute at @s run tp ^^1^0.2
execute at @s run tp ^^1^0.2