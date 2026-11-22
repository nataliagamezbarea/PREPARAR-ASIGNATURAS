import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const asignaturasMedio = [
  {
    id: "sor",
    nombre: "SOR · Sistemas Operativos en Red",
    grado: "Segundo_grado_medio",
    archivo: "./data/asignaturas/sor/preguntas.json",
    descripcion: "2º Grado Medio SMR · Dominios Active Directory, Samba, LDAP, usuarios, grupos y GPOs",
    temas: [
      {
        numero: 1,
        nombre: "Tema 1 · Instalación y arquitectura de sistemas operativos en red",
        apartados: [
          { numero: 1, nombre: "1.1 Conceptos de cliente-servidor y roles de red" },
          { numero: 2, nombre: "1.2 Instalación de Windows Server y Linux Server" },
          { numero: 3, nombre: "1.3 Configuración básica de interfaces de red y nombres" }
        ]
      },
      {
        numero: 2,
        nombre: "Tema 2 · Servicios de directorio: Active Directory y LDAP",
        apartados: [
          { numero: 1, nombre: "2.1 Estructura lógica y física de Active Directory" },
          { numero: 2, nombre: "2.2 Controladores de dominio (DC) y catálogos globales" },
          { numero: 3, nombre: "2.3 Unidades organizativas (OU), usuarios y grupos" }
        ]
      },
      {
        numero: 3,
        nombre: "Tema 3 · Compartición de recursos y servidores de archivos",
        apartados: [
          { numero: 1, nombre: "3.1 Permisos NTFS y permisos de recurso compartido (SMB)" },
          { numero: 2, nombre: "3.2 Servidor Samba en Linux integrado con dominio" },
          { numero: 3, nombre: "3.3 Cuotas de disco y almacenamiento distribuido" }
        ]
      },
      {
        numero: 4,
        nombre: "Tema 4 · Directivas de grupo (GPO) y mantenimiento del sistema",
        apartados: [
          { numero: 1, nombre: "4.1 Creación, enlace y precedencia de directivas GPO" },
          { numero: 2, nombre: "4.2 Despliegue de software y restricciones de seguridad" },
          { numero: 3, nombre: "4.3 Copias de seguridad y monitorización del servidor" }
        ]
      }
    ],
    preguntas: [
      {
        id: "sor_q1",
        tema: 1,
        apartado: 1,
        apartadoNombre: "1.1 Conceptos de cliente-servidor y roles de red",
        tipo: "teoria",
        enunciado: "¿Cuál es la función principal de un controlador de dominio en una red con Windows Server?",
        opciones: {
          A: "Autenticar y autorizar a todos los usuarios y equipos de la red mediante una base de datos centralizada.",
          B: "Asignar automáticamente direcciones IP dinámicas a los clientes de la red.",
          C: "Enrutar paquetes entre diferentes redes físicas y subredes.",
          D: "Actuar únicamente como servidor proxy de navegación web."
        },
        correcta: "A",
        explicacion: "El controlador de dominio (DC) aloja Active Directory Domain Services y se encarga de la autenticación y autorización centralizada de cuentas y recursos."
      },
      {
        id: "sor_q2",
        tema: 1,
        apartado: 2,
        apartadoNombre: "1.2 Instalación de Windows Server y Linux Server",
        tipo: "teoria",
        enunciado: "¿Qué ventaja ofrece la instalación de Windows Server en modo 'Server Core' frente a la versión con experiencia de escritorio?",
        opciones: {
          A: "Mayor superficie de ataque y mayor consumo de memoria RAM.",
          B: "Menor consumo de recursos, menor superficie de ataque y menos reinicios por actualizaciones.",
          C: "Permite ejecutar programas gráficos de diseño 3D más rápido.",
          D: "No necesita conexión de red ni tarjeta de interfaz."
        },
        correcta: "B",
        explicacion: "Server Core no incluye entorno gráfico de escritorio, reduciendo el consumo de RAM, CPU y la superficie de exposición a vulnerabilidades."
      },
      {
        id: "sor_q3",
        tema: 2,
        apartado: 1,
        apartadoNombre: "2.1 Estructura lógica y física de Active Directory",
        tipo: "teoria",
        enunciado: "En la jerarquía de Active Directory, ¿qué elemento representa el límite administrativo y de seguridad de más alto nivel?",
        opciones: {
          A: "La Unidad Organizativa (OU).",
          B: "El Bosque (Forest).",
          C: "El Árbol (Tree).",
          D: "El Sitio (Site)."
        },
        correcta: "B",
        explicacion: "El bosque es el límite de seguridad supremo de Active Directory. Todos los árboles y dominios de un bosque comparten el mismo esquema y catálogo global."
      },
      {
        id: "sor_q4",
        tema: 2,
        apartado: 3,
        apartadoNombre: "2.3 Unidades organizativas (OU), usuarios y grupos",
        tipo: "teoria",
        enunciado: "¿Cuál es el propósito fundamental de crear Unidades Organizativas (OUs) en un dominio?",
        opciones: {
          A: "Vincular directivas de grupo (GPO) y delegar tareas de administración sobre un subconjunto de objetos.",
          B: "Aumentar la velocidad del cableado de red.",
          C: "Definir subredes físicas en diferentes ciudades.",
          D: "Sustituir a los switches de red por software."
        },
        correcta: "A",
        explicacion: "Las OUs permiten estructurar lógicamente los objetos del dominio para aplicarles GPOs específicas y delegar permisos de gestión a administradores locales."
      },
      {
        id: "sor_q5",
        tema: 3,
        apartado: 1,
        apartadoNombre: "3.1 Permisos NTFS y permisos de recurso compartido (SMB)",
        tipo: "teoria",
        enunciado: "Si un usuario accede por red a una carpeta con permiso compartido de 'Lectura' pero permiso NTFS de 'Control Total', ¿cuál es su permiso efectivo final?",
        opciones: {
          A: "Control Total.",
          B: "Lectura (el permiso más restrictivo prevalece).",
          C: "Modificar.",
          D: "Acceso denegado absoluto."
        },
        correcta: "B",
        explicacion: "Al combinar permisos compartidos (Share) y permisos del sistema de archivos (NTFS) a través de la red, siempre se aplica la combinación más restrictiva."
      },
      {
        id: "sor_q6",
        tema: 3,
        apartado: 2,
        apartadoNombre: "3.2 Servidor Samba en Linux integrado con dominio",
        tipo: "teoria",
        enunciado: "¿Qué protocolo de red implementa Samba en sistemas Linux para compartir carpetas e impresoras con clientes Windows?",
        opciones: {
          A: "SMB / CIFS.",
          B: "SNMPv3.",
          C: "TFTP.",
          D: "Telnet."
        },
        correcta: "A",
        explicacion: "Samba implementa los protocolos SMB (Server Message Block) y CIFS, permitiendo la interoperabilidad nativa entre sistemas Unix/Linux y clientes Windows."
      },
      {
        id: "sor_q7",
        tema: 4,
        apartado: 1,
        apartadoNombre: "4.1 Creación, enlace y precedencia de directivas GPO",
        tipo: "teoria",
        enunciado: "¿En qué orden se procesan por defecto las Directivas de Grupo (GPO) en un entorno de Active Directory?",
        opciones: {
          A: "LSDOU: Local, Sitio (Site), Dominio (Domain), Unidad Organizativa (OU).",
          B: "OU, Dominio, Sitio, Local.",
          C: "Dominio, Local, OU, Sitio.",
          D: "Únicamente en el orden alfabético de sus nombres."
        },
        correcta: "A",
        explicacion: "La regla mnemotécnica estándar es LSDOU: primero Local, luego Sitio, después Dominio y finalmente Unidad Organizativa (las de OU prevalecen sobre las anteriores salvo bloqueo de herencia)."
      },
      {
        id: "sor_q8",
        tema: 4,
        apartado: 3,
        apartadoNombre: "4.3 Copias de seguridad y monitorización del servidor",
        tipo: "teoria",
        enunciado: "¿Qué comando de consola en Windows permite forzar la actualización inmediata de las directivas de grupo en un equipo cliente?",
        opciones: {
          A: "gpupdate /force",
          B: "ipconfig /renew",
          C: "netdom resetpwd",
          D: "sfc /scannow"
        },
        correcta: "A",
        explicacion: "'gpupdate /force' refresca de forma inmediata tanto las directivas de equipo como de usuario aplicadas mediante GPO."
      }
    ]
  },
  {
    id: "seg",
    nombre: "SEG · Seguridad Informática",
    grado: "Segundo_grado_medio",
    archivo: "./data/asignaturas/seg/preguntas.json",
    descripcion: "2º Grado Medio SMR · Seguridad física y lógica, firewalls, copias de seguridad, criptografía y RGPD",
    temas: [
      {
        numero: 1,
        nombre: "Tema 1 · Principios de seguridad y legislación",
        apartados: [
          { numero: 1, nombre: "1.1 Triada CIA (Confidencialidad, Integridad, Disponibilidad)" },
          { numero: 2, nombre: "1.2 Amenazas, vulnerabilidades y vectores de ataque" },
          { numero: 3, nombre: "1.3 Marco legal: RGPD y LOPD-GDD" }
        ]
      },
      {
        numero: 2,
        nombre: "Tema 2 · Seguridad pasiva y copias de seguridad",
        apartados: [
          { numero: 1, nombre: "2.1 SAIs (UPS), climatización y protección física" },
          { numero: 2, nombre: "2.2 Tipos de copia de seguridad: completa, diferencial e incremental" },
          { numero: 3, nombre: "2.3 Regla 3-2-1 y planes de recuperación ante desastres (DRP)" }
        ]
      },
      {
        numero: 3,
        nombre: "Tema 3 · Criptografía, firmas y certificados digitales",
        apartados: [
          { numero: 1, nombre: "3.1 Criptografía simétrica frente a asimétrica" },
          { numero: 2, nombre: "3.2 Funciones hash y verificación de integridad" },
          { numero: 3, nombre: "3.3 Autoridades de certificación (CA) y certificados X.509" }
        ]
      },
      {
        numero: 4,
        nombre: "Tema 4 · Seguridad perimetral y cortafuegos (Firewalls)",
        apartados: [
          { numero: 1, nombre: "4.1 Cortafuegos con estado (Stateful Inspection) y tablas de estado" },
          { numero: 2, nombre: "4.2 Reglas de filtrado iptables / nftables y UFW en Linux" },
          { numero: 3, nombre: "4.3 Zonas desmilitarizadas (DMZ) y VPNs" }
        ]
      }
    ],
    preguntas: [
      {
        id: "seg_q1",
        tema: 1,
        apartado: 1,
        apartadoNombre: "1.1 Triada CIA",
        tipo: "teoria",
        enunciado: "¿A qué pilar de la triada CIA afecta un ataque de denegación de servicio distribuido (DDoS)?",
        opciones: {
          A: "A la Disponibilidad.",
          B: "A la Confidencialidad exclusivamente.",
          C: "Al No repudio de firmas.",
          D: "A la Criptoanalítica."
        },
        correcta: "A",
        explicacion: "Un ataque DoS o DDoS busca saturar los recursos de un servicio para que los usuarios legítimos no puedan acceder, atacando directamente la Disponibilidad."
      },
      {
        id: "seg_q2",
        tema: 2,
        apartado: 2,
        apartadoNombre: "2.2 Tipos de copia de seguridad",
        tipo: "teoria",
        enunciado: "¿Cuál es la principal diferencia entre una copia de seguridad diferencial y una incremental?",
        opciones: {
          A: "La diferencial copia todo lo modificado desde la última copia completa; la incremental solo lo modificado desde la última copia (sea completa o incremental).",
          B: "La incremental nunca borra el bit de archivo y la diferencial siempre lo desactiva.",
          C: "La diferencial tarda más en restaurarse que la incremental.",
          D: "No hay diferencia, son nombres sinónimos."
        },
        correcta: "A",
        explicacion: "La copia diferencial respalda los cambios acumulados desde el último backup completo. La incremental solo guarda lo cambiado desde el último backup previo de cualquier tipo."
      },
      {
        id: "seg_q3",
        tema: 2,
        apartado: 3,
        apartadoNombre: "2.3 Regla 3-2-1",
        tipo: "teoria",
        enunciado: "¿En qué consiste la regla 3-2-1 de copias de seguridad recomendada por INCIBE?",
        opciones: {
          A: "3 copias de los datos en 2 soportes distintos y al menos 1 copia fuera de la sede (offsite/cloud).",
          B: "Hacer copias a las 3:21 de la madrugada todos los días.",
          C: "Guardar 3 versiones de cada archivo durante 2 meses en 1 disco duro.",
          D: "Comprimir 3 veces el backup con contraseñas de 21 caracteres."
        },
        correcta: "A",
        explicacion: "La regla 3-2-1 establece tener 3 copias de tus datos importantes, en 2 soportes o tecnologías distintas, con 1 de ellas ubicada fuera de las instalaciones físicas."
      },
      {
        id: "seg_q4",
        tema: 3,
        apartado: 1,
        apartadoNombre: "3.1 Criptografía simétrica y asimétrica",
        tipo: "teoria",
        enunciado: "En un esquema de cifrado asimétrico (clave pública y privada), si Ana quiere enviarle un mensaje confidencial a Beto, ¿con qué clave debe cifrarlo?",
        opciones: {
          A: "Con la clave pública de Beto.",
          B: "Con la clave privada de Beto.",
          C: "Con la clave privada de Ana.",
          D: "Con la clave pública de la Autoridad de Certificación."
        },
        correcta: "A",
        explicacion: "Para garantizar la confidencialidad, el emisor cifra con la clave pública del destinatario; así solo el destinatario con su clave privada correspondiente podrá descifrarlo."
      },
      {
        id: "seg_q5",
        tema: 3,
        apartado: 2,
        apartadoNombre: "3.2 Funciones hash",
        tipo: "teoria",
        enunciado: "¿Cuál de las siguientes es una propiedad esencial de una función resumen o hash criptográfico seguro (ej. SHA-256)?",
        opciones: {
          A: "Resistencia a colisiones y efecto avalancha (un cambio mínimo en la entrada altera completamente la salida).",
          B: "Poder reconstruir el texto original a partir del hash resultante.",
          C: "Generar hashes de longitud variable según el tamaño del archivo analizado.",
          D: "Permitir descifrar contraseñas conociendo solo la clave privada."
        },
        correcta: "A",
        explicacion: "Una función hash segura es unidireccional (irreversible), de longitud fija, produce el efecto avalancha y tiene alta resistencia a colisiones."
      },
      {
        id: "seg_q6",
        tema: 4,
        apartado: 1,
        apartadoNombre: "4.1 Cortafuegos con estado",
        tipo: "teoria",
        enunciado: "¿Por qué un cortafuegos con inspección de estado (stateful firewall) es superior a un simple filtro de paquetes estático?",
        opciones: {
          A: "Porque monitoriza el estado de las conexiones activas y permite el tráfico de respuesta legítimo (RELATED, ESTABLISHED).",
          B: "Porque impide por completo el uso de cables Ethernet.",
          C: "Porque convierte la dirección IP pública en privada sin usar NAT.",
          D: "Porque descifra todo el tráfico HTTPS sin certificados."
        },
        correcta: "A",
        explicacion: "Un firewall con estado guarda registro de los flujos de comunicación abiertos y permite automáticamente el tráfico de vuelta perteneciente a conexiones válidas ya establecidas."
      },
      {
        id: "seg_q7",
        tema: 4,
        apartado: 2,
        apartadoNombre: "4.2 Reglas de filtrado en Linux",
        tipo: "teoria",
        enunciado: "En un servidor Ubuntu con cortafuegos UFW activo, ¿qué comando abre el puerto TCP 443 para conexiones web seguras?",
        opciones: {
          A: "sudo ufw allow 443/tcp",
          B: "sudo ufw deny 443",
          C: "sudo iptables -X 443",
          D: "sudo ufw block port 443"
        },
        correcta: "A",
        explicacion: "'ufw allow 443/tcp' crea una regla de entrada que permite el tráfico entrante al puerto HTTPS (443 TCP)."
      },
      {
        id: "seg_q8",
        tema: 4,
        apartado: 3,
        apartadoNombre: "4.3 Zonas desmilitarizadas (DMZ)",
        tipo: "teoria",
        enunciado: "¿Cuál es el objetivo principal de situar un servidor web público dentro de una Zona Desmilitarizada (DMZ)?",
        opciones: {
          A: "Evitar que si el servidor web es comprometido, el atacante tenga acceso directo a la red interna corporativa.",
          B: "Hacer que las páginas web carguen más rápido en internet.",
          C: "Eliminar la necesidad de utilizar contraseñas en los routers.",
          D: "Conectar los equipos sin necesidad de cables ni switches."
        },
        correcta: "A",
        explicacion: "La DMZ aísla los servidores accesibles desde Internet de la red local interna protegida (LAN), limitando el impacto en caso de intrusión."
      }
    ]
  },
  {
    id: "ser",
    nombre: "SER · Servicios en Red",
    grado: "Segundo_grado_medio",
    archivo: "./data/asignaturas/ser/preguntas.json",
    descripcion: "2º Grado Medio SMR · Protocolos de red, DNS, DHCP, servidores Web, FTP y correo",
    temas: [
      {
        numero: 1,
        nombre: "Tema 1 · Direccionamiento IP y servicio DHCP",
        apartados: [
          { numero: 1, nombre: "1.1 Rangos IP privados (RFC 1918) y máscaras de subred" },
          { numero: 2, nombre: "1.2 Funcionamiento de DHCP: proceso DORA" },
          { numero: 3, nombre: "1.3 Reservas de IP por dirección MAC y opciones DHCP" }
        ]
      },
      {
        numero: 2,
        nombre: "Tema 2 · Resolución de nombres: DNS",
        apartados: [
          { numero: 1, nombre: "2.1 Estructura jerárquica del DNS y servidores raíz" },
          { numero: 2, nombre: "2.2 Tipos de registros DNS: A, AAAA, CNAME, MX, PTR, NS" },
          { numero: 3, nombre: "2.3 Zonas directas e inversas y reenviadores (forwarders)" }
        ]
      },
      {
        numero: 3,
        nombre: "Tema 3 · Servidores de transferencia y alojamiento: Web y FTP",
        apartados: [
          { numero: 1, nombre: "3.1 Servidores Web Apache y Nginx: Virtual Hosts y puertos" },
          { numero: 2, nombre: "3.2 Protocolo FTP activo frente a pasivo" },
          { numero: 3, nombre: "3.3 Seguridad en transferencias: FTPS y SFTP" }
        ]
      },
      {
        numero: 4,
        nombre: "Tema 4 · Servicios de correo y mensajería",
        apartados: [
          { numero: 1, nombre: "4.1 Protocolos SMTP, POP3 e IMAP" },
          { numero: 2, nombre: "4.2 Agentes de correo: MUA, MTA y MDA" },
          { numero: 3, nombre: "4.3 Mecanismos antispam: SPF, DKIM y DMARC" }
        ]
      }
    ],
    preguntas: [
      {
        id: "ser_q1",
        tema: 1,
        apartado: 2,
        apartadoNombre: "1.2 Proceso DORA en DHCP",
        tipo: "teoria",
        enunciado: "¿Cuál es la secuencia correcta de los cuatro mensajes intercambiados en la asignación dinámica por DHCP?",
        opciones: {
          A: "Discover, Offer, Request, Acknowledge (DORA).",
          B: "Demand, Obtain, Renew, Accept.",
          C: "Discover, Open, Read, Apply.",
          D: "Dial, Operate, Route, Assign."
        },
        correcta: "A",
        explicacion: "El protocolo DHCP sigue el proceso DORA: DHCPDiscover (difusión del cliente), DHCPOffer (propuesta del servidor), DHCPRequest (solicitud del cliente) y DHCPAck (confirmación final del servidor)."
      },
      {
        id: "ser_q2",
        tema: 2,
        apartado: 2,
        apartadoNombre: "2.2 Registros DNS",
        tipo: "teoria",
        enunciado: "¿Qué tipo de registro DNS asocia un nombre de dominio al servidor de correo electrónico encargado de recibir sus mensajes?",
        opciones: {
          A: "Registro MX (Mail Exchange).",
          B: "Registro A.",
          C: "Registro CNAME.",
          D: "Registro PTR."
        },
        correcta: "A",
        explicacion: "El registro MX especifica los servidores de correo responsables de recibir los emails enviados a ese dominio, acompañados de una prioridad numérica."
      },
      {
        id: "ser_q3",
        tema: 2,
        apartado: 2,
        apartadoNombre: "2.2 Registros DNS",
        tipo: "teoria",
        enunciado: "¿Para qué sirve un registro DNS de tipo CNAME (Canonical Name)?",
        opciones: {
          A: "Para crear un alias que apunta a otro nombre canónico de dominio.",
          B: "Para asociar un nombre directamente con una dirección IPv6.",
          C: "Para realizar la resolución inversa de IP a nombre.",
          D: "Para definir la zona horaria del servidor."
        },
        correcta: "A",
        explicacion: "El registro CNAME funciona como un alias que redirige un subdominio o nombre hacia otro nombre de dominio FQDN existente."
      },
      {
        id: "ser_q4",
        tema: 3,
        apartado: 2,
        apartadoNombre: "3.2 Protocolo FTP activo frente a pasivo",
        tipo: "teoria",
        enunciado: "¿Por qué en clientes situados tras un router con NAT o cortafuegos se debe utilizar preferentemente el modo FTP Pasivo (PASV)?",
        opciones: {
          A: "Porque en modo pasivo es el cliente quien inicia tanto la conexión de control como la de datos hacia puertos altos del servidor.",
          B: "Porque el modo activo no permite subir archivos de más de 1 MB.",
          C: "Porque el modo pasivo cifra automáticamente el tráfico con SSL.",
          D: "Porque el modo activo requiere obligatoriamente fibra óptica."
        },
        correcta: "A",
        explicacion: "En modo pasivo, el cliente inicia ambas conexiones hacia el servidor, evitando que el firewall o NAT del cliente bloquee la conexión entrante de datos que iniciaría el servidor en modo activo."
      },
      {
        id: "ser_q5",
        tema: 4,
        apartado: 1,
        apartadoNombre: "4.1 Protocolos de correo",
        tipo: "teoria",
        enunciado: "¿Cuál es la principal ventaja de utilizar el protocolo IMAP en lugar de POP3 para consultar el correo electrónico?",
        opciones: {
          A: "Mantiene los correos y carpetas sincronizados en el servidor, permitiendo acceder desde múltiples dispositivos.",
          B: "Envía los mensajes de correo sin pasar por un servidor SMTP.",
          C: "Descarga los correos y los elimina inmediatamente del servidor.",
          D: "Solo funciona cuando no hay conexión a internet."
        },
        correcta: "A",
        explicacion: "IMAP sincroniza el estado de los buzones y mensajes directamente en el servidor, ideal para usuarios con varios clientes o dispositivos."
      }
    ]
  },
  {
    id: "aw",
    nombre: "AW · Aplicaciones Web",
    grado: "Segundo_grado_medio",
    archivo: "./data/asignaturas/aw/preguntas.json",
    descripcion: "2º Grado Medio SMR · Gestores de contenidos (CMS), servidores web, comercio electrónico y ofimática web",
    temas: [
      {
        numero: 1,
        nombre: "Tema 1 · Servidores de aplicaciones web y entorno LAMP/WAMP",
        apartados: [
          { numero: 1, nombre: "1.1 Pila de tecnologías LAMP (Linux, Apache, MySQL, PHP)" },
          { numero: 2, nombre: "1.2 Gestión de bases de datos relacionales con phpMyAdmin" },
          { numero: 3, nombre: "1.3 Seguridad en la configuración de PHP y permisos de ficheros" }
        ]
      },
      {
        numero: 2,
        nombre: "Tema 2 · Gestores de contenidos (CMS): instalación y mantenimiento",
        apartados: [
          { numero: 1, nombre: "2.1 Estructura y arquitectura de WordPress, Joomla y Moodle" },
          { numero: 2, nombre: "2.2 Archivo de configuración wp-config.php y conexión a base de datos" },
          { numero: 3, nombre: "2.3 Gestión de temas, plugins y actualización del CMS" }
        ]
      },
      {
        numero: 3,
        nombre: "Tema 3 · Seguridad, rendimiento y comercio electrónico",
        apartados: [
          { numero: 1, nombre: "3.1 Plataformas de e-commerce: WooCommerce y PrestaShop" },
          { numero: 2, nombre: "3.2 Copias de seguridad de la base de datos y archivos multimedia" },
          { numero: 3, nombre: "3.3 Optimización de caché y prevención de inyecciones SQL" }
        ]
      }
    ],
    preguntas: [
      {
        id: "aw_q1",
        tema: 1,
        apartado: 1,
        apartadoNombre: "1.1 Pila LAMP",
        tipo: "teoria",
        enunciado: "¿Qué componente de la pila LAMP se encarga de ejecutar el código dinámico del lado del servidor?",
        opciones: {
          A: "El intérprete de PHP.",
          B: "El gestor de base de datos MySQL.",
          C: "El navegador del cliente.",
          D: "El sistema operativo Linux únicamente."
        },
        correcta: "A",
        explicacion: "PHP procesa los scripts en el servidor antes de entregar el HTML generado al servidor web Apache para enviarlo al cliente."
      },
      {
        id: "aw_q2",
        tema: 2,
        apartado: 2,
        apartadoNombre: "2.2 Archivo de configuración de WordPress",
        tipo: "teoria",
        enunciado: "¿En qué archivo raíz de WordPress se configuran las credenciales de acceso a la base de datos MySQL (DB_NAME, DB_USER, DB_PASSWORD)?",
        opciones: {
          A: "wp-config.php",
          B: ".htaccess",
          C: "index.php",
          D: "wp-settings.php"
        },
        correcta: "A",
        explicacion: "'wp-config.php' es el archivo de configuración primordial de WordPress donde se definen las constantes de conexión con la base de datos."
      },
      {
        id: "aw_q3",
        tema: 3,
        apartado: 1,
        apartadoNombre: "3.1 Plataformas de e-commerce",
        tipo: "teoria",
        enunciado: "¿Qué extensión o plugin oficial convierte una instalación estándar de WordPress en una completa tienda online de comercio electrónico?",
        opciones: {
          A: "WooCommerce.",
          B: "phpMyAdmin.",
          C: "Yoast SEO.",
          D: "Elementor."
        },
        correcta: "A",
        explicacion: "WooCommerce es el plugin libre de comercio electrónico líder para la plataforma WordPress."
      }
    ]
  }
];

async function main() {
  console.log("Generando bancos de preguntas para Segundo Grado Medio...");

  // Leer asignaturas.json existentes
  const asigPath = path.join(rootDir, "data", "asignaturas.json");
  const pubAsigPath = path.join(rootDir, "public", "data", "asignaturas.json");

  let asignaturasExistentes = [];
  try {
    const raw = await fs.readFile(asigPath, "utf8");
    const parsed = JSON.parse(raw);
    asignaturasExistentes = parsed.asignaturas || [];
  } catch (e) {
    console.warn("No se pudo leer asignaturas existentes:", e.message);
  }

  // Marcar WEC con su grado si no lo tiene
  for (const asig of asignaturasExistentes) {
    if (!asig.grado) {
      asig.grado = asig.id === "wec" || asig.id === "daw" ? "Primer_grado_superior_DAW" : "Primer_grado_superior_DAW";
    }
  }

  // Guardar cada asignatura nueva
  for (const item of asignaturasMedio) {
    const dirData = path.join(rootDir, "data", "asignaturas", item.id);
    const dirPublicData = path.join(rootDir, "public", "data", "asignaturas", item.id);
    await fs.mkdir(dirData, { recursive: true });
    await fs.mkdir(dirPublicData, { recursive: true });

    const bancoCompleto = {
      formato: "preparar-tests-banco-preguntas",
      version: 1,
      clave: `${item.id.toUpperCase()}-banco-oficial`,
      meta: {
        asignatura: item.id.toUpperCase(),
        titulo: `${item.nombre} · Banco de Preguntas`,
        tema: 0,
        temas: item.temas.map(t => t.numero),
        apartado: 0,
        total: item.preguntas.length,
        version: "1.0",
        grado: item.grado
      },
      preguntas: item.preguntas
    };

    const bancoJson = JSON.stringify(bancoCompleto, null, 2);
    await fs.writeFile(path.join(dirData, "preguntas.json"), bancoJson, "utf8");
    await fs.writeFile(path.join(dirPublicData, "preguntas.json"), bancoJson, "utf8");

    // Guardar también en datos/bancos/<ID>/
    const dirBancos = path.join(rootDir, "datos", "bancos", item.id.toUpperCase());
    await fs.mkdir(dirBancos, { recursive: true });
    await fs.writeFile(path.join(dirBancos, `${item.id.toUpperCase()}-temas-todos-apartado-0.json`), bancoJson, "utf8");

    // Agregar o actualizar en la lista del catálogo
    const index = asignaturasExistentes.findIndex(a => a.id === item.id);
    const entryCatalog = {
      id: item.id,
      nombre: item.nombre,
      grado: item.grado,
      archivo: item.archivo,
      descripcion: item.descripcion,
      temas: item.temas,
      totalPreguntas: item.preguntas.length
    };

    if (index >= 0) {
      asignaturasExistentes[index] = entryCatalog;
    } else {
      asignaturasExistentes.push(entryCatalog);
    }
  }

  const catalogObj = { asignaturas: asignaturasExistentes };
  const catalogStr = JSON.stringify(catalogObj, null, 2);
  await fs.writeFile(asigPath, catalogStr, "utf8");
  await fs.writeFile(pubAsigPath, catalogStr, "utf8");

  // También sincronizar con docs/ si existe
  const docsAsigPath = path.join(rootDir, "docs", "data", "asignaturas.json");
  try {
    await fs.writeFile(docsAsigPath, catalogStr, "utf8");
  } catch (_) {}

  console.log("¡Bancos de Segundo Grado Medio generados con éxito!");
}

main().catch(console.error);
