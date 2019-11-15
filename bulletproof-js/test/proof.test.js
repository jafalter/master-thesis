const EC = require('elliptic').ec;
const assert = require('assert');

const Factory = require('../src/ProofFactory');
const Utils = require('../src/Utils');
const Maths = require('../src/Maths');
const secp256k1 = require('../src/Constants').secp256k1;

const ec = new EC('secp256k1');

describe('Tests for the rangeproof', () => {

    it('Test additive homomorphic quality of pedersen commitments', () => {
        const v1 = 9018549012398012093n;
        const x1 = 89124798129839871987249812n;
        const c1 = Utils.getPedersenCommitment(v1, x1);

        const v2 = 90172589102478901273n;
        const x2 = 509867892649082376409171892n;
        const c2 = Utils.getPedersenCommitment(v2, x2);

        const c3 = Utils.getPedersenCommitment(v1 + v2, x1 + x2,);
        assert(c1.add(c2).eq(c3));
    });

    it('Test mult properties of pedersen commitments', () => {
        const sc = 8091561783246108246301n;

        const t1 = 78689278935479823809745892304n;
        const r = 89124798129839871987249812n;
        const T1 = Utils.getPedersenCommitment(t1, r);

        const T2 = Utils.getPedersenCommitment(t1 * sc, r * sc);

        assert(T1.mul(Utils.toBN(sc)).eq(T2));
    });

    it('Test mult properties of pedersen with negative num', () => {
        const p = secp256k1.p;
        const t1 = Maths.mod(-4424687248756834944667496427199067151987779098219282389160949909025658367322n, p);
        const x = Maths.mod(38659561957554344830346811456777626115164894886626759056962864666140509109118n, p);
        const xBN  = Utils.toBN(x);
        const r = Maths.mod(206032474729127474062261152183333172264689698899312462254655119185748812599n, p);

        const T1 = Utils.getPedersenCommitment(t1, r);
        const T1cmp = Utils.getPedersenCommitment(Maths.mod(t1 * x, p), Maths.mod(r * x, p));

        assert(T1.mul(xBN).eq(T1cmp));
    });

    it('Should create a range proof', () => {
        const x = 1897278917812981289198n;
        const val = 25n;
        const low = 0n;
        const upper = 2n ** 64n;

        const V = Utils.getPedersenCommitment(val, x);
        const G = ec.g;
        const H = Utils.getHFromHashingG(G);

        const prf = Factory.computeBulletproof(val, x, V, G, H, low, upper, secp256k1.p);
    });
});