import Foundation

let source = Data([70,87,83,17,10,0,0,0,1,2])
let target = Data([70,87,83,17,11,0,0,0,1,2,3])
let value: [String: Any] = ["sourceHash": PatchRecipe.hash(source), "resultHash": PatchRecipe.hash(target),
    "resultSize": target.count, "operations": [["offset":0,"length":4],
        ["add":Data([11,0,0,0]).base64EncodedString()], ["offset":8,"length":2],
        ["add":Data([3]).base64EncodedString()]]]
let recipe = try JSONDecoder().decode(PatchRecipe.self, from: JSONSerialization.data(withJSONObject: value))
let result = try recipe.apply(source)
assert(result == target)
let repeated = try recipe.apply(target)
assert(repeated == target)
for invalid in [Data(), Data([70,87,83]), Data([70,87,83,17,255,255,255,255])] {
    var rejected = false
    do { _ = try recipe.apply(invalid) } catch { rejected = true }
    assert(rejected)
}
var bad = value
bad["operations"] = [["offset":100,"length":4]]
let bounds = try JSONDecoder().decode(PatchRecipe.self, from: JSONSerialization.data(withJSONObject: bad))
var rejected = false
do { _ = try bounds.apply(source) } catch { rejected = true }
assert(rejected)
print("PASS: generated local fixture, idempotence, version/header/size validation and copy bounds")
