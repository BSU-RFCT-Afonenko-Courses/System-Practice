// Проверка установленных потребителей path/base на действительных семи проектах.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeProjectContract,
  readProjectContexts,
} from "../tasks/_extensions/Afonenko-Course-Tools/course-core/public.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const owner = join(root, "tasks");
const directories: string[] = [];
for await (const group of Deno.readDir(join(owner, "projects"))) {
  if (!group.isDirectory) continue;
  for await (
    const project of Deno.readDir(join(owner, "projects", group.name))
  ) {
    if (!project.isDirectory) continue;
    const directory = join("projects", group.name, project.name);
    try {
      await Deno.stat(join(owner, directory, "_metadata.yml"));
      directories.push(directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}
directories.sort();
if (directories.length !== 7) {
  throw Error("Ожидались семь действительных проектов SP");
}
let addresses = 0;
await readProjectContexts([{
  owner,
  directories,
  profiles: ["student"],
  format: "html",
}], async ([group]) => {
  if (!group) throw Error("Не получена группа действительных проектов SP");
  for (const context of group.contexts) {
    const contract = decodeProjectContract(context);
    const paths = [
      contract.starter,
      ...Object.values(contract.instructions ?? {}),
      ...Object.values(contract.solutions),
      ...Object.values(contract.components),
      ...Object.values(contract.testsets),
      ...Object.values(contract.build.files),
    ];
    for (const address of paths) {
      if (!address) continue;
      await Deno.stat(address.path);
      addresses++;
    }
    if (context.input === join(owner, "projects/project-maintenance/release")) {
      const archive = contract.build.files["project-maintenance-start.zip"];
      if (!archive) throw Error("Не объявлен стартовый архив сопровождения");
      if (
        archive.path !== join(owner, "materials/project-maintenance-start.zip")
      ) {
        throw Error("Архив сопровождения потерял базу YAML объявления");
      }
      const bytes = await Deno.readFile(archive.path);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw Error("Ожидался действительный ZIP");
      }
    }
  }
});
console.log(
  JSON.stringify({ status: "PASS", projects: directories.length, addresses }),
);
