execute at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[tag=!_air_like] at @s run tp ~~0.1~
scoreboard players add @s cd 0
scoreboard players add @s[scores={cd=0..50}] cd 1
scoreboard players set @s[scores={cd=51..}] cd -100
scoreboard players add @s[scores={cd=..-10}] cd 1
execute as @s[tag=!return] at @s run tp ~~~ ~ 0
execute as @s[scores={cd=-90..-61}] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=-90..-61},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=-90..-61},tag=_air_like] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=-90..-61},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=-90..-61},tag=_air_like] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=-90..-61},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=1..}] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=1..},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=1..},tag=_air_like] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=1..},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=1..},tag=_air_like] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=1..},tag=_air_like] at @s run tp ~~-0.1~
tag @s[scores={cd=-60..-1}] add return
execute as @s[tag=!tsed,tag=!return,scores={cd=0..49}] at @s positioned ^^0.5^0.5 run function util/check_air_like
execute at @s[tag=!tsed,tag=!return,tag=_air_like,scores={cd=0..49}] run tp ^^^0.3
tag @s remove _air_like