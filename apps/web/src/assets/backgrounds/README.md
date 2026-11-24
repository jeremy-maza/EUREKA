# Escenarios

Coloca aquí el escenario de cada mundo con el nombre `<slug>-background.png` (p. ej. `arithmetic-background.png`).
La pantalla lo cargará como fondo del escenario cuando el archivo esté disponible.
Mientras tanto, el área muestra un color celeste provisional y plataformas de interfaz.

Las islas alternan entre izquierda y derecha y ascienden por las superficies situadas en
84%/68%/52%/36%/24% de la altura. Su posición horizontal se calcula de forma responsive
para conservar despejada la operación central. Si el fondo incluye sus propias islas, las
islas SVG de respaldo se ocultan cuando se carga la ilustración.

Sin ilustración, la ruta de islas se genera según la longitud de la secuencia (una isla por reto más la de llegada).
Con ilustración se usa la ruta fija de 5 islas de arriba; las secuencias más largas terminan en la última isla.
