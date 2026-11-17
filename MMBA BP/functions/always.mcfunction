gamerule sendcommandfeedback false
gamerule commandblockoutput false
gamerule showtags false

scoreboard objectives add blockIn dummy
scoreboard objectives add standC dummy
scoreboard players add @a standC 0
scoreboard objectives add special dummy
scoreboard players add @a special 0
scoreboard objectives add energy dummy
scoreboard players add @a energy 0
scoreboard objectives add sp1 dummy
scoreboard players add @a sp1 0
scoreboard objectives add m1 dummy
scoreboard players add @a m1 0
scoreboard objectives add family dummy
scoreboard players add @a family 0
scoreboard objectives add sneak dummy
scoreboard players add @a sneak 0
scoreboard objectives add stun dummy
scoreboard objectives add stun2 dummy
scoreboard players add @a stun 0
scoreboard objectives add vit dummy
scoreboard objectives add atk dummy
scoreboard objectives add def dummy
scoreboard objectives add pen dummy
scoreboard objectives add dex dummy
scoreboard objectives add luck dummy
scoreboard objectives add merit dummy

# --- Utils

scoreboard objectives add act dummy
scoreboard players add @a act 0
scoreboard objectives add iFrames dummy
scoreboard players remove @e[scores={iFrames=1..}] iFrames 1
scoreboard objectives add movesScript dummy
scoreboard objectives add cd dummy
scoreboard players add @a cd 0

scoreboard players set @e[type=player,tag=!onSkill] movesScript 0
scoreboard players add @e[type=player,tag=onSkill] movesScript 1

scoreboard players remove @e[scores={sp1=1..}] sp1 1
scoreboard players add @e[scores={sp1=..-1}] sp1 1
scoreboard players set @e[scores={sp1=0}] m1 0

scoreboard players remove @e[scores={cd=1..}] cd 1
scoreboard players add @e[scores={cd=..-1}] cd 1

execute as @a at @s run function util/onground
effect @a[scores={sp1=18,m1=1..4}] slowness 1 0 true

execute as @a[scores={m1=0},tag=!onSKill,tag=!tusk_detached,tag=!tusk_spatial,tag=!tim_unravel] run event entity @s xvoid:jatuh

scoreboard players set @a[tag=lowCD,scores={cd=1..,sneak=0}] cd 0
tag @a[scores={cd=0}] remove lowCD

function proj/proj
function util/ts

tag @a[scores={standC=1..}] add hasStand
tag @a[scores={standC=0}] remove hasStand

# --- Stun ------------------

scoreboard players reset @e[scores={stun=0},type=!player] stun
scoreboard players reset @e[scores={stun2=0}] stun2

scoreboard players remove @e[scores={stun=1..}] stun 1
scoreboard players remove @e[scores={stun2=1..}] stun2 1
scoreboard players add @e[scores={stun2=..-1}] stun2 1

scoreboard players set @a[tag=customing] ultimate 5
scoreboard players set @a[tag=customing] stun 5

execute as @e[scores={stun2=1..}] at @s run tp ~~~
execute as @e[scores={stun2=..-2}] at @s run tp ~~~
execute as @e[scores={stun2=-1}] at @s run scriptevent apply:knockback -2,0.5

inputpermission set @a[scores={stun=2..}] lateral_movement disabled
inputpermission set @a[scores={stun=1}] lateral_movement enabled
inputpermission set @a[scores={stun=2..}] jump disabled
inputpermission set @a[scores={stun=1}] jump enabled

effect @e[scores={stun=2..},type=!player] slowness 1 255 true
effect @e[scores={stun=2..}] weakness 1 255 true
effect @e[scores={stun=2..}] mining_fatigue 1 20 true
effect @e[scores={stun=1}] slowness 0 255 true
effect @e[scores={stun=1}] weakness 0 255 true
effect @e[scores={stun=1}] mining_fatigue 0 10 true
tag @e[scores={stun=1..}] add stun
tag @e[scores={stun=!1..}] remove stun

title @a[tag=stun,tag=!tsed] actionbar §c< You Are Stunned >
title @a[tag=stun,tag=tsed,scores={tser=0}] actionbar §c< Time Is Stopped >
title @a[tag=nstd,tag=!stun] actionbar §c< Unable to use abilities >

# --- stands ---------------

function stands
inputpermission set @a[scores={sp1=9},tag=!stun,tag=!clashing,tag=!ts_exhausted] jump enabled
inputpermission set @a[scores={sp1=-1},tag=!stun,tag=!clashing,tag=!ts_exhausted] jump enabled
