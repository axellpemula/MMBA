#time stop
scoreboard objectives add ts dummy
scoreboard players add @a ts 0
scoreboard objectives add tsed dummy
scoreboard players remove @e[scores={ts=1..}] ts 1
scoreboard players add @e[scores={tsed=..1}] tsed 1
scoreboard objectives add tser dummy

execute as @e[scores={ts=1}] at @s unless entity @e[scores={ts=1..},rm=0.1,r=50] run fog @s remove "ts"
tag @e[scores={ts=2..}] add ts
tag @e[scores={ts=..1}] remove ts

execute as @a[tag=tsed] at @s run tp @s ~~~

scoreboard players set @e[tag=tsed] stun 5
effect @e[scores={ts=1..}] night_vision 1 2 true
effect @a[tag=tsed,scores={tser=1..}] slow_falling 1 255 true

execute as @e[scores={ts=2..}] at @s run scoreboard players set @s tsed -1
execute as @e[scores={tsed=1..}] at @s run tag @e remove tsed
execute as @e[scores={tsed=..-1}] at @s run tag @e[scores={ts=!1..},tag=!ts_exhausted,r=50] add tsed
tag @e[scores={ts=1..}] remove tsed
tag @e[tag=ts_exhausted] remove tsed
effect @e[tag=tsed,type=!player] blindness 1 0 true
camera @a[tag=tsed,scores={tser=0}] fade time 0.1 0 0.1 color 0 0 0
effect @a[tag=tsed,scores={tser=0}] blindness 1 0 true 


effect @a[scores={stun=2..,tser=1..},tag=!tsed] slowness 1 255 true
effect @a[scores={stun=2..,tser=0}] slowness 1 255 true
effect @e[scores={stun=2..},type=!player] slowness 1 255 true
effect @e[scores={stun=2..}] weakness 1 255 true
effect @e[scores={stun=2..}] mining_fatigue 1 20 true
effect @e[scores={stun=1}] slowness 0 255 true
effect @e[scores={stun=1}] weakness 0 255 true
effect @e[scores={stun=1}] mining_fatigue 0 10 true
tag @e[scores={stun=1..}] add stun
tag @e[scores={stun=!1..}] remove stun