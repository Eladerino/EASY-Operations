// shared.js — pure certificate logic, no DOM, no Electron.
//
// Loaded by the renderer via <script> and unit-testable in plain Node.
(function (root) {
  'use strict';

  // Course catalogue. Kept identical to the original app.
  const titlesByCategory = {
    'workplace-nl-approved-training': [
      { value: 'confined-space-entry', label: 'Confined Space Entry',
        description:
`This 2-day course gives students the training needed to work safely in confined spaces, preventing injuries, property damage, fatalities, and other associated hazards. Students learn to recognize confined-space hazards and control them, the legislative requirements that apply, and how to manage hazards through administrative, engineering, and PPE controls.

The course includes a group practical (groups of 4-7): bump testing of gas monitors; inspection and use of air-supplying and air-purifying breathing apparatuses; pre-entry setup of ventilation systems; a complete hazard and risk assessment based on a supplied scenario; applying isolations; full PPE use; and a complete entry exercise incorporating every role of a confined space entry program. An exam is included.

Duration: 2 days

Course chapters:
- Identifying Confined Spaces
- Roles and Responsibilities of Workplace Parties
- Confined Space Entry Legislation
- Confined Space Entry Program
- Atmospheric Hazards & Controls
- Health & Safety Hazards
- Personal Protective Equipment
- Confined Space Roles and Responsibilities
- Confined Space Entry Permit
- Confined Space Entry Rescue
- Accident/Incident Reporting` },
      { value: 'fall-protection', label: 'Fall Protection',
        description:
`This 2-day course follows the federal regulations of Canada and the requirements for compliance with current CSA/ANSI standards and Newfoundland & Labrador's Acts and Regulations for fall protection. Students learn the principles of fall protection and prevention, the types of fall protection systems and guidance on the appropriate use of each, complete full inspections of 12 pieces of equipment, work through calculations and case studies, and demonstrate and practice proper equipment use in practical exercises.

Includes an exam and practical: proper use and inspection of equipment, plus completing and following a fall protection plan and hazard/risk assessment.

Duration: 2 days

Course chapters:
- Introduction to Fall Protection
- Roles and Responsibilities of Workplace Parties
- Fall Protection Legislation
- Fall Protection Plan
- Fall Protection System Forces and Components
- Hierarchy of Controls
- Fall Protection Systems, Equipment and Components
- Fall Arrest Systems, Equipment and Components
- Use, Care, Maintenance and Storage of Equipment
- General Requirements of Fall Arrest Rescue Plan
- Accident/Incident Reporting` },
      { value: 'fall-protection-recertification', label: 'Fall Protection Recertification',
        description:
`This 1-day recertification covers the same scope as the full Fall Protection course: federal regulations of Canada, CSA/ANSI standards, and Newfoundland & Labrador's Acts and Regulations. Students review the principles of protection and fall prevention, the types of fall protection systems and their appropriate use, complete full inspections of 12 pieces of equipment, work through calculations and case studies, and demonstrate and practice proper equipment use.

Includes an exam and practical: proper use and inspection of equipment, plus completing and following a fall protection plan and hazard/risk assessment.

Duration: 1 day

Course chapters:
- Introduction to Fall Protection
- Roles and Responsibilities of Workplace Parties
- Fall Protection Legislation
- Fall Protection Plan
- Fall Protection System Forces and Components
- Hierarchy of Controls
- Fall Protection Systems, Equipment and Components
- Fall Arrest Systems, Equipment and Components
- Use, Care, Maintenance and Storage of Equipment
- General Requirements of Fall Arrest Rescue Plan` },
      { value: 'ohs-committee1', label: 'OH&S Committee I',
        description:
`This 2-day course provides the knowledge to locate information in the Occupational Health and Safety legislation and address OH&S issues in the workplace. Students learn to find the legislative information needed to address workplace issues, the requirements for establishing and operating an effective OH&S committee, and how to identify, assess, and recommend corrective actions to control workplace hazards.

Duration: 2 days

Course chapters:
- Introduction to Occupational Health and Safety
- Internal Responsibility System
- The Essentials of an OH&S Committee
- Hazard Recognition, Evaluation and Control
- Workplace Inspections
- Accident/Incident Investigation
- Linking OH&S Committee to OH&S Program
- Making it Effective` },
      { value: 'ohs-committee2', label: 'OH&S Committee II',
        description:
`This 2-day course provides the knowledge to locate information in the Occupational Health and Safety legislation and address OH&S issues in the workplace. Students learn to find the legislative information needed to address workplace issues, the requirements for establishing and operating an effective OH&S committee, and how to identify, assess, and recommend corrective actions to control workplace hazards.

Duration: 2 days

Course chapters:
- Introduction to Occupational Health and Safety
- Internal Responsibility System
- The Essentials of an OH&S Committee
- Hazard Recognition, Evaluation and Control
- Workplace Inspections
- Accident/Incident Investigation
- Linking OH&S Committee to OH&S Program
- Making it Effective` },
      { value: 'powerline-hazards', label: 'Powerline Hazards',
        description:
`This 1-day course is based on the requirements set by the Workplace Health, Safety & Compensation Commission. Students gain a basic knowledge of electricity and electrical hazards, safety measures for working around above-ground and underground transmission lines, what to do if equipment becomes energized by an electrical current, and a review of the applicable legislative requirements.

Duration: 1 day

Course chapters:
- Welcome to Powerline Hazards
- Learning Objectives
- Introduction
- Training Topics
- Course Summary` },
      { value: 'traffic-control', label: 'Traffic Control Person',
        description:
`This 1-day course gives Traffic Control Persons the skills and knowledge needed to provide proper traffic controls for the safety of drivers, workers, and the general public. Students learn to perform traffic control competently and safely, consistent with legislation and industry standards. An exam is included.

Duration: 1 day

Course chapters:
- The Importance of Traffic Control Person Training
- Roles and Responsibilities of Workplace Parties
- Traffic Control Legislation
- Roles and Responsibilities of Traffic Control Persons
- Traffic Control Devices and Hazard Control
- Worksite Setup, Maintenance and Removal
- Heavy/Construction Equipment and Powerline Hazards
- Emergency Preparedness and Response Activities
- Accident/Incident Reporting
- Accident/Incident Investigation` },
    ],
    'powered-mobile-equipment': [
      { value: 'counter-balance-forklift', label: 'Counter Balance Forklift',
        description:
`This 1-day course provides new and experienced operators with the knowledge and skills to safely operate a forklift. New operators gain the necessary operating skills, experienced operators advance their knowledge and skills, and all students learn ways to reduce the risk of injury.

Includes an exam and practical: pre-use orientation, visual and workplace inspections, and lifting, lowering, and moving various loads.

Duration: 1 day

Course chapters:
- The Rules
- Types of Forklifts
- Main Parts of a Counterbalanced Forklift
- Understanding Forklift Safety
- Safe Forklift Operation
- Fuel Types and Batteries` },
      { value: 'skid-steer',               label: 'Skid Steer' },
      { value: 'telehandler-7',            label: 'Telehandler (Class7)' },
      { value: 'aerial-work-platform', label: 'Aerial Work Platform',
        description:
`Prerequisite: Fall Protection.

This 1-day course provides the knowledge and skills required to operate boom and scissor lifts safely and efficiently, building toward competent, safe operation and qualification.

Includes an exam and practical: pre-use operations, workplace inspections, demonstration and safe use of all operational functions, and demonstration and safe use of all emergency functions.

Duration: 1 day

Course chapters:
- Regulations, Standards & Policies
- Types of Aerial Lifts
- Parts and Functionality
- Safety Systems and Devices
- Dimensions, Measurements & Capabilities
- Stability and Capacity
- Inspections
- Fall Protection
- Safe Operating Procedures
- Parking and Shutdown` },
    ],
    'confined-space-training': [
      { value: 'confined-space-rescue', label: 'Confined Space Rescue',
        description:
`Prerequisites: Fall Protection, Confined Space Entry, and Emergency First Aid.

This 2-day course focuses on the hazards of working in confined spaces, the Occupational Health & Safety Regulations and CSA Z1006 (Management of Work in Confined Spaces), and the proper equipment used in confined space rescues. It builds the student's ability to perform a confined space rescue and provides essential information for anyone who could be involved in a confined space emergency.

Includes an exam and practical exercises practicing confined space rescue with all equipment and procedures from the theory, following the rescue phases - preparation, assessment, pre-entry operations, entry and rescue operations, and termination - with the appropriate equipment.

Duration: 2 days

Course chapters:
- Phases of Confined Space Rescue
- Rescue Equipment, Knots & Systems
- High Point Anchor Systems
- Communications
- Permitting Confined Spaces
- Review` },
      { value: 'gas-detection',                    label: 'Gas Detection' },
      { value: 'lockout-tagout', label: 'Lockout/Tagout',
        description:
`This half-day course covers the proper methods of a lockout/tagout program. Students learn the hazards of working with controlled energy and the proper methods to control energy through a properly developed and implemented lockout program. An exam is included.

Duration: 1/2 day

Course chapters:
- Energy and Lockout/Tagout
- Identifying what is Lockout/Tagout
- Errors Involved in Energy-Related Accidents
- Different Forms of Energy and their Appropriate Hazards
- Lockout/Tagout Devices (Theory and Practical Examples of Isolation)
- The 7-Step Procedure` },
      { value: 'regulatory-awareness', label: 'Regulatory Awareness',
        description:
`This half-day course gives personnel a basic understanding of the legislation and regulations applicable to offshore petroleum operations, including rights and obligations under the legislation and the duties of operators and employers. A review and exam are included.

Duration: 1/2 day

Topics covered:
- Overview of applicable safety-related legislation
- Overview of each applicable safety-related regulation
- Overview of applicable guidance issued by relevant regulatory authorities
- Overview of the regulatory structure and the roles of the various regulatory bodies
- Overview of regulatory processes including work authorizations, certificates of fitness, compliance audits, and enforcement
- Powers and authority of energy authority Safety Officers
- The internal responsibility system
- Operator and employer duties and obligations
- Worker rights and obligations, with emphasis on the rights to know, participate, and refuse, and the obligations to work safely and report incidents and accidents
- The Regulatory Query process` },
      { value: 'respiratory-protective-equipment', label: 'Respiratory Protective Equipment',
        description:
`This 1-day course gives workers the skills and information needed to properly maintain respiratory protective equipment, ensuring effective use, care, and maintenance. Students learn to identify the need for respiratory protection and the different types of respiratory equipment, the differences among types, and gain practical skills for proper use, care, and maintenance, including inspection and use.

Includes an exam and practical: pre-use inspection, proper donning and doffing techniques, and use of SABA, SCBA, and air-purifying respirators.

Duration: 1 day` },
      { value: 'saba-scba',                        label: 'SABA/SCBA' },
    ],
    'first-aid': [
      { value: 'emergency-first-aid', label: 'Emergency First Aid' },
      { value: 'standard-first-aid',  label: 'Standard First Aid' },
    ],
    'scaffolding': [
      { value: 'frame', label: 'Frame',
        description:
`Prerequisite: Fall Protection.

This 1-day theory course provides instruction on the safe erection, inspection, tagging, and dismantling of frame scaffolding in residential and commercial environments, with in-depth theory and hands-on practical portions. (Practical days can be added to suit client needs - a minimum of 2 practical days is recommended.)

Students learn the applicable OHS regulations and CSA standards, how to complete hazard and risk assessments through site inspection and documentation, tie-in methods and proper bracing, material handling and tools for erection, commonly used hand signals, and practice inspecting and tagging scaffolds and components, plus safe use from planning through dismantling.

An exam is included (70% required to proceed to the practical). Practical: pre-use inspection of equipment; proper erection, inspection, tagging, and dismantling; documenting inspections; and installing proper tagging systems (green, yellow, or red). Students are also graded on meeting course requirements and standards.

Duration: 1 day theory

Course chapters:
- Introduction
- Safe Erection of Towers
- Providing Access
- Braces and Ties` },
      { value: 'inspection-awareness', label: 'Inspection Awareness',
        description:
`Prerequisite: Fall Protection.

This 1-day theory course provides instruction on the safe erection, inspection, tagging, and dismantling of scaffolding in residential and commercial environments, with in-depth theory and hands-on practical portions. (Practical days can be added to suit client needs - a minimum of 2 practical days is recommended.) It covers tube & clamp, frame, and system scaffolding types.

Students learn the applicable OHS regulations and CSA standards, how to complete hazard and risk assessments through site inspection and documentation, tie-in methods and proper bracing, material handling and tools for erection, commonly used hand signals, and practice inspecting and tagging scaffolds and components, plus safe use from planning through dismantling.

An exam is included (70% required to proceed to the practical). Practical: pre-use inspection of equipment; proper erection, inspection, tagging, and dismantling; documenting inspections; and installing proper tagging systems (green, yellow, or red). Students are also graded on meeting course requirements and standards.

Duration: 1 day theory

Course chapters:
- Introduction
- Safe Erection of Towers
- Providing Access
- Braces and Ties` },
      { value: 'swing-stage', label: 'Swing Stage',
        description:
`Prerequisite: Fall Protection.

This 1-day theory course provides instruction on the safe erection, inspection, tagging, and dismantling of swing stage scaffolding in residential and commercial environments, with in-depth theory and hands-on practical portions.

Students learn the applicable OHS regulations and CSA standards, how to complete hazard and risk assessments through site inspection and documentation, tie-in methods and proper bracing, material handling and tools for erection, commonly used hand signals, and practice inspecting and tagging scaffolds and components, plus safe use from planning through dismantling.

An exam is included (70% required to proceed to the practical). Practical: pre-use inspection of equipment; proper erection, inspection, tagging, and dismantling; documenting inspections; and tagging systems (green, yellow, or red).

Duration: 1 day theory

Course chapters:
- Swing Stage Components
- Thrust Outs and Support Hooks
- Wall Rollers and Tie Offs
- Manual Winches
- Power Swing Stage Hoists
- Fall Arrest Equipment
- Wire Rope Fittings
- Swing Stage Safety Rules` },
      { value: 'system', label: 'System',
        description:
`Prerequisite: Fall Protection.

This 1-day theory course provides instruction on the safe erection, inspection, tagging, and dismantling of system scaffolding in residential and commercial environments, with in-depth theory and hands-on practical portions. (Practical days can be added to suit client needs - a minimum of 2 practical days is recommended.)

Students learn the applicable OHS regulations and CSA standards, how to complete hazard and risk assessments through site inspection and documentation, tie-in methods and proper bracing, material handling and tools for erection, commonly used hand signals, and practice inspecting and tagging scaffolds and components, plus safe use from planning through dismantling.

An exam is included (70% required to proceed to the practical). Practical: pre-use inspection of equipment; proper erection, inspection, tagging, and dismantling; documenting inspections; and installing proper tagging systems (green, yellow, or red). Students are also graded on meeting course requirements and standards.

Duration: 1 day theory

Course chapters:
- Introduction
- Safe Erection of Towers
- Providing Access
- Braces and Ties` },
      { value: 'tube-clamp', label: 'Tube & Clamp',
        description:
`Prerequisite: Fall Protection.

This 1-day theory course provides instruction on the safe erection, inspection, tagging, and dismantling of tube & clamp scaffolding in residential and commercial environments, with in-depth theory and hands-on practical portions. (Practical days can be added to suit client needs - a minimum of 2 practical days is recommended.)

Students learn the applicable OHS regulations and CSA standards, how to complete hazard and risk assessments through site inspection and documentation, tie-in methods and proper bracing, material handling and tools for erection, commonly used hand signals, and practice inspecting and tagging scaffolds and components, plus safe use from planning through dismantling.

An exam is included (70% required to proceed to the practical). Practical: pre-use inspection of equipment; proper erection, inspection, tagging, and dismantling; documenting inspections; and installing proper tagging systems (green, yellow, or red). Students are also graded on meeting course requirements and standards.

Duration: 1 day theory

Course chapters:
- Introduction
- Safe Erection of Towers
- Providing Access
- Braces and Ties` },
    ],
    'additional-safety-training': [
      { value: 'arc-flash', label: 'Arc Flash',
        description:
`This 1-day course provides new and experienced individuals with the knowledge and skills to work safely around arc flash hazards. New students gain the necessary skills and knowledge for the environment, experienced students advance their knowledge and skills, and all learn ways to reduce the risk of injury.

Includes an exam and practical.

Duration: 1 day

Course chapters:
- Components and Definitions
- Arc Flash
- Codes and Standards
- Protective Clothing and Equipment
- Arc Flash Injuries
- Prevention` },
      { value: 'drops-prevention', label: 'DROPS Prevention',
        description:
`This half-day course raises awareness of dropped objects: how to recognize possible dropped objects and identify their causes, the methods for preventing and controlling dropped objects, and each worker's personal responsibility in preventing them. A review and exam are included.

Duration: 1/2 day

Course chapters:
- Raise Awareness
- Control and Prevent` },
      { value: 'hazard-risk-assessment',         label: 'Hazard and Risk Assessment' },
      { value: 'offshore-fall-protection',       label: 'Offshore Fall Protection' },
      { value: 'transportation-dangerous-goods', label: 'Transportation of Dangerous Goods',
        description:
`This half-day course is based on the nationally recognized Transportation of Dangerous Goods information system. Students learn the TDG information system: how to properly identify, label, and handle dangerous goods, and how to prevent incidents and protect the public and the environment. An exam is included.

Duration: 1/2 day

Topics covered:
- Overview of TDG requirements
- Responsibilities of shippers, handlers, and drivers
- Classes of dangerous goods
- Shipping documents
- Safety marks
- Containers
- Special situations
- Emergency actions` },
      { value: 'trenching-excavation', label: 'Trenching & Excavation',
        description:
`This 1-day course addresses the trenching and excavation requirements of Occupational Health & Safety. Students learn to recognize trenching and excavation hazards and the protective measures and equipment required before entering a trench. An exam is included.

Duration: 1 day

Course chapters:
- Introduction
- Legislation
- Hazard Identification
- Soil
- Control Measures
- Emergency Response` },
      { value: 'whmis', label: 'WHMIS',
        description:
`This 1-day course gives students the skills to protect their health and safety when working in proximity to or with WHMIS-controlled products. Students learn the importance of WHMIS, the roles and responsibilities of all workplace parties in WHMIS education, how to identify hazard symbols, and how to read and understand WHMIS safety data sheets. An exam is included.

Duration: 1 day

Course chapters:
- Introduction
- Hazards
- Labels
- Material Safety Data Sheet (MSDS)
- Protection and Emergencies` },
    ],
    'crane-rigging-training': [
      { value: 'overhead-crane-rigging', label: 'Overhead Crane Rigging',
        description:
`This 1-day course provides workers with basic overhead crane rigging concepts and proper inspection criteria: proper use of slings and associated rigging equipment, proper pre-use inspection of rigging equipment, load weight estimation and the importance of proper sling angles, and demonstration and practice of safe lifting procedures.

Includes an exam and practical: pre-use inspections, safe crane operations, and proper rigging, moving, and lifting of loads.

Duration: 1 day

Course chapters:
- Introduction to Overhead Cranes
- Basic Rigging Concepts
- Rigging Gear & Inspection Criteria
- Putting Slings to Work - Hitch, Capacity & Hardware
- Safe Rigging Practices & Procedures for the Offshore Oil & Gas Industry` },
      { value: 'overhead-crane-rigging-slinging', label: 'Overhead Crane Rigging & Slinging',
        description:
`This 1-day course familiarizes workers with basic rigging and slinging concepts: proper use of slings and associated rigging equipment, proper pre-use inspection procedures, load weight estimation and the importance of proper sling angles, and demonstration and practice of safe lifting practices and procedures, making lifts with manually operated devices as well as cranes.

Includes an exam and practical: proper pre-use inspections and the proper rigging, moving, and lifting of loads.

Duration: 1 day

Course chapters:
- Basic Rigging Concepts
- Rigging Gear & Inspection Criteria
- Putting Slings to Work - Hitch, Capacity & Hardware
- Safe Rigging Practices & Procedures for the Offshore Oil & Gas Industry` },
      { value: 'rigging-slinging-banksmen', label: 'Rigging, Slinging & Banksmen',
        description:
`This 3-day course familiarizes workers with basic rigging and slinging concepts: proper use of slings and associated rigging equipment, proper pre-use inspection procedures, load weight estimation and the importance of proper sling angles, and demonstration and practice of safe lifting practices and procedures, making lifts with manually operated devices as well as cranes.

Day 3 covers lift planning and moving loads with hand-operated equipment (lever and chain hoists), proper rigging procedures, knots and tag lines; after all lifts, students use a crane to practice rigging, handling, and signaling loads in an outside environment.

Includes an exam and practical: thorough inspections of 12 pieces of equipment (shackles, wire rope slings, synthetic slings, chain, turnbuckles, pad eyes, beam clamps, beam trolleys, chain hoists, lever hoists, snatch blocks, eye bolts, and tirfors).

Duration: 3 days

Course chapters:
- Rigging Procedures and Precautions
- Wire Rope
- Slings
- Chain Slings
- Rigging Hardware
- Hand Signals
- Knots, Bends and Hitches
- Color Coding of Rigging Equipment
- Radio Communication in Rigging
- Jacks, Rollers and Related Devices
- Hoists, Winches and Related Devices
- Occupational Health and Safety Regulations` },
    ],
  };

  const WPNL_CATEGORY = 'workplace-nl-approved-training';
  const FORKLIFT_VALUE = 'counter-balance-forklift';

  // e.g. ("2026-09-30", "counter-balance-forklift", 1) -> "260930COUNTERBALANCEFORKLIFT01"
  function makeCertificateNumber(completionDate, courseTitleValue, instanceNumber) {
    const date = String(completionDate).replace(/-/g, '').slice(2);
    const titleCode = String(courseTitleValue).replace(/-/g, '').toUpperCase();
    return `${date}${titleCode}${String(instanceNumber).padStart(2, '0')}`;
  }

  function sanitizeFilename(str) {
    return String(str).replace(/[^a-z0-9_-]/gi, '');
  }

  // "Counter Balance Forklift" + ["1","4","5"] -> "Counter Balance Forklift (Class 1-4-5)"
  function makePdfCourseName(displayedTitle, courseValue, selectedClasses) {
    if (courseValue === FORKLIFT_VALUE && selectedClasses.length) {
      return `${displayedTitle} (Class ${selectedClasses.join('-')})`;
    }
    return displayedTitle;
  }

  function makeFilenameCoursePart(displayedTitle, courseValue) {
    if (courseValue === FORKLIFT_VALUE) return 'CounterBalanceForklift';
    return String(displayedTitle).replace(/\s+/g, '');
  }

  function makePdfFilename(studentName, filenameCoursePart, completionDate) {
    return `${sanitizeFilename(studentName)}-${filenameCoursePart}-${completionDate}.pdf`;
  }

  function makePostTitle(completionDate, pdfCourseName, studentName) {
    return `${completionDate} - ${pdfCourseName} - ${studentName}`;
  }

  // Certificates expire 3 years after completion.
  function expiryPlus3Years(completionDate) {
    const [y, m, d] = String(completionDate).split('-');
    return `${parseInt(y, 10) + 3}-${m}-${d}`;
  }

  const api = {
    titlesByCategory,
    WPNL_CATEGORY,
    FORKLIFT_VALUE,
    makeCertificateNumber,
    sanitizeFilename,
    makePdfCourseName,
    makeFilenameCoursePart,
    makePdfFilename,
    makePostTitle,
    expiryPlus3Years,
  };

  root.EasyCertShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
