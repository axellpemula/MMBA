scoreboard objectives add cd dummy
execute as @a[scores={sneak=0,sneakTemp=1..}] run scriptevent xvoid:nono
execute as @e[type=jjba:steelball,tag=!tsed,tag=!spin,tag=!wrecking,tag=normal] at @s run function proj/steelball/steelball
execute as @e[type=jjba:steelball,tag=!tsed,tag=!spin,tag=!wrecking,tag=snek] at @s run function proj/steelball/steelball2
tag @e[type=jjba:steelball,tag=!tsed,tag=!spin,tag=!wrecking,tag=!snek,tag=!normal] add snek
